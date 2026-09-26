import { closeSync, constants, fstatSync, openSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const MAX_REQUEST_BYTES = 64 * 1024;
export const MAX_BATCH_SIZE = 20;
const MAX_SESSION_BYTES = 4096;
const MAX_VALUE_BYTES = 24 * 1024;
const MAX_RESPONSE_BYTES = 64 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Selector = { itemId: string; kind: "password" } | { itemId: string; kind: "field"; name: string };
type VaultItem = {
  id?: unknown;
  login?: { password?: unknown };
  fields?: Array<{ name?: unknown; type?: unknown; value?: unknown }>;
};

export type SecretResolverResponse = {
  protocolVersion: 1;
  values: Record<string, string>;
  errors: Record<string, string>;
};

export type SecretResolverOptions = {
  env?: NodeJS.ProcessEnv;
  homeDirectory?: string;
  getItem?: (itemId: string, session: string) => Promise<VaultItem>;
};

function errorResponse(ids: string[] = ["*"]): SecretResolverResponse {
  return {
    protocolVersion: 1,
    values: {},
    errors: Object.fromEntries(ids.map((id) => [id, "Unable to resolve secret"])),
  };
}

function parseSelector(id: string): Selector | undefined {
  const match = /^([^/]+)\/(password|field\/(.+))$/.exec(id);
  if (!match || !UUID.test(match[1]!)) return undefined;
  if (match[2] === "password") return { itemId: match[1]!, kind: "password" };
  const name = match[3]!;
  if (!name || name.length > 256 || /[\u0000-\u001f\u007f/]/.test(name) || name.trim() !== name) return undefined;
  return { itemId: match[1]!, kind: "field", name };
}

function readSession(env: NodeJS.ProcessEnv, homeDirectory: string): string {
  if (Object.hasOwn(env, "BW_SESSION")) {
    const session = env.BW_SESSION;
    if (!session || session.length > MAX_SESSION_BYTES || /\s/.test(session)) {
      throw new Error("invalid session");
    }
    return session;
  }

  const path = env.VAULTWARDEN_SESSION_FILE || join(homeDirectory, ".openclaw", "secrets", "vaultwarden-session");
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size < 1 || stat.size > MAX_SESSION_BYTES) {
      throw new Error("invalid session file");
    }
    if ((typeof process.getuid === "function" && stat.uid !== process.getuid()) || (stat.mode & 0o077) !== 0) {
      throw new Error("unsafe session file");
    }
    const contents = readFileSync(fd, "utf8");
    const session = contents.endsWith("\n") ? contents.slice(0, -1) : contents;
    if (!session || /\s/.test(session) || Buffer.byteLength(session, "utf8") > MAX_SESSION_BYTES) {
      throw new Error("invalid session file");
    }
    return session;
  } finally {
    closeSync(fd);
  }
}

function selectValue(item: VaultItem, selector: Selector): string {
  const checked = (value: string) => {
    if (Buffer.byteLength(value, "utf8") > MAX_VALUE_BYTES) throw new Error("value too large");
    return value;
  };
  if (item.id !== selector.itemId) throw new Error("item mismatch");
  if (selector.kind === "password") {
    if (typeof item.login?.password !== "string" || !item.login.password) throw new Error("password missing");
    return checked(item.login.password);
  }
  const matches = (item.fields ?? []).filter((field) => field.name === selector.name);
  if (matches.length !== 1) throw new Error("field missing or ambiguous");
  const [field] = matches;
  if ((field?.type !== 0 && field?.type !== 1 && field?.type !== "text" && field?.type !== "hidden") ||
      typeof field.value !== "string" || !field.value) {
    throw new Error("field unsupported");
  }
  return checked(field.value);
}

export async function resolveSecretRequest(
  rawInput: string,
  options: SecretResolverOptions = {},
): Promise<SecretResolverResponse> {
  if (Buffer.byteLength(rawInput, "utf8") > MAX_REQUEST_BYTES) return errorResponse();

  let body: unknown;
  try {
    body = JSON.parse(rawInput);
  } catch {
    return errorResponse();
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) return errorResponse();
  const request = body as { protocolVersion?: unknown; ids?: unknown };
  if (request.protocolVersion !== 1 || !Array.isArray(request.ids) ||
      request.ids.length < 1 || request.ids.length > MAX_BATCH_SIZE ||
      request.ids.some((id) => typeof id !== "string" || id.length > 512 || !parseSelector(id))) {
    return errorResponse();
  }
  const ids = request.ids as string[];
  const selectors = ids.map((id) => parseSelector(id)!);
  let session: string;
  try {
    session = readSession(options.env ?? process.env, options.homeDirectory ?? homedir());
  } catch {
    return errorResponse(ids);
  }

  const values: Record<string, string> = {};
  const errors: Record<string, string> = {};
  const itemCache = new Map<string, Promise<VaultItem>>();
  for (let index = 0; index < ids.length; index += 1) {
    const id = ids[index]!;
    const selector = selectors[index]!;
    try {
      let itemPromise = itemCache.get(selector.itemId);
      if (!itemPromise) {
        const getItem = options.getItem;
        if (!getItem) throw new Error("resolver unavailable");
        itemPromise = getItem(selector.itemId, session);
        itemCache.set(selector.itemId, itemPromise);
      }
      values[id] = selectValue(await itemPromise, selector);
    } catch {
      errors[id] = "Unable to resolve secret";
    }
  }
  const response = { protocolVersion: 1 as const, values, errors };
  if (Buffer.byteLength(JSON.stringify(response), "utf8") > MAX_RESPONSE_BYTES) {
    return errorResponse(ids);
  }
  itemCache.clear();
  return response;
}
