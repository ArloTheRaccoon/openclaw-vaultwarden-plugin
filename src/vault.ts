export type CliRunner = (args: string[], stdin?: string) => Promise<{ stdout: string; stderr: string }>;

type RawVaultItem = {
  [key: string]: unknown;
  id?: unknown;
  name?: unknown;
  type?: unknown;
  folderId?: unknown;
  collectionIds?: unknown;
  login?: { [key: string]: unknown; uris?: Array<{ uri?: unknown }> };
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_ITEM_BYTES = 64 * 1024;
const MAX_SECRET_BYTES = 24 * 1024;
const mutationLocks = new Map<string, Promise<void>>();

async function withMutationLock<T>(itemId: string, operation: () => Promise<T>): Promise<T> {
  const previous = mutationLocks.get(itemId) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  mutationLocks.set(itemId, current);
  await previous;
  try {
    return await operation();
  } finally {
    release();
    if (mutationLocks.get(itemId) === current) mutationLocks.delete(itemId);
  }
}

export type LoginFieldInput = {
  name: string;
  value: string;
  type?: "text" | "hidden";
};

export type LoginItemInput = {
  name: string;
  username?: string;
  password?: string;
  uris?: string[];
  notes?: string;
  folderId?: string | null;
  collectionIds?: string[];
  fields?: LoginFieldInput[];
  favorite?: boolean;
};

export type LoginItemPatch = {
  name?: string;
  username?: string | null;
  password?: string | null;
  uris?: string[];
  notes?: string | null;
  folderId?: string | null;
  collectionIds?: string[];
  fields?: LoginFieldInput[];
  favorite?: boolean;
};

type LoginVaultItem = {
  [key: string]: unknown;
  id?: unknown;
  type: 1;
  name: string;
  folderId?: string | null;
  collectionIds?: string[];
  favorite?: boolean;
  notes?: string | null;
  fields?: Array<{ name: string; value: string; type: 0 | 1 }>;
  login?: {
    [key: string]: unknown;
    username?: string | null;
    password?: string | null;
    uris?: Array<{ uri: string; match?: number | null }>;
  };
};

function checkedString(value: unknown, label: string, maxBytes = MAX_SECRET_BYTES): string {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value) ||
    Buffer.byteLength(value, "utf8") > maxBytes
  ) {
    throw new Error(`Invalid ${label}`);
  }
  return value;
}

function checkedNote(value: unknown): string {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value) ||
    Buffer.byteLength(value, "utf8") > MAX_SECRET_BYTES
  ) {
    throw new Error("Invalid notes");
  }
  return value;
}

function checkedId(value: unknown, label: string): string {
  if (typeof value !== "string" || !UUID.test(value)) {
    throw new Error(`Invalid ${label}`);
  }
  return value;
}

function checkedUriList(uris: unknown): Array<{ uri: string }> {
  if (!Array.isArray(uris) || uris.length > 100) throw new Error("Invalid URIs");
  return uris.map((uri) => ({ uri: checkedString(uri, "URI", 4096) }));
}

function checkedFields(fields: unknown): Array<{ name: string; value: string; type: 0 | 1 }> {
  if (!Array.isArray(fields) || fields.length > 100) throw new Error("Invalid fields");
  const names = new Set<string>();
  return fields.map((value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid field");
    const field = value as LoginFieldInput;
    const name = checkedString(field.name, "field name", 256);
    if (names.has(name)) throw new Error("Duplicate field name");
    names.add(name);
    if (field.type !== undefined && field.type !== "text" && field.type !== "hidden") {
      throw new Error("Invalid field type");
    }
    return {
      name,
      value: checkedString(field.value, "field value"),
      type: field.type === "text" ? 0 : 1,
    };
  });
}

function checkedCollectionIds(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 100) throw new Error("Invalid collections");
  return value.map((id) => checkedId(id, "collection ID"));
}

export function buildLoginVaultItem(input: LoginItemInput): LoginVaultItem {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Invalid item");
  const item: LoginVaultItem = {
    type: 1,
    name: checkedString(input.name, "item name", 256),
  };
  const login: NonNullable<LoginVaultItem["login"]> = {};
  if (input.username !== undefined) login.username = checkedString(input.username, "username");
  if (input.password !== undefined) login.password = checkedString(input.password, "password");
  if (input.uris !== undefined) login.uris = checkedUriList(input.uris);
  if (Object.keys(login).length > 0) item.login = login;
  if (input.notes !== undefined) item.notes = checkedNote(input.notes);
  if (input.folderId !== undefined) {
    item.folderId = input.folderId === null ? null : checkedId(input.folderId, "folder ID");
  }
  if (input.collectionIds !== undefined) item.collectionIds = checkedCollectionIds(input.collectionIds);
  if (input.fields !== undefined) item.fields = checkedFields(input.fields);
  if (input.favorite !== undefined) {
    if (typeof input.favorite !== "boolean") throw new Error("Invalid favorite flag");
    item.favorite = input.favorite;
  }
  return item;
}

export function mergeLoginVaultItem(raw: unknown, patch: LoginItemPatch): LoginVaultItem {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("Invalid existing item");
  const existing = raw as Record<string, unknown>;
  const itemId = checkedId(existing.id, "item ID");
  if (existing.type !== 1 || !existing.login || typeof existing.login !== "object") {
    throw new Error("Only login items can be updated");
  }
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) throw new Error("Invalid update");
  const item = structuredClone(existing) as LoginVaultItem;
  item.id = itemId;
  if (patch.name !== undefined) item.name = checkedString(patch.name, "item name", 256);
  if (patch.folderId !== undefined) {
    item.folderId = patch.folderId === null ? null : checkedId(patch.folderId, "folder ID");
  }
  if (patch.collectionIds !== undefined) item.collectionIds = checkedCollectionIds(patch.collectionIds);
  if (patch.fields !== undefined) item.fields = checkedFields(patch.fields);
  if (patch.favorite !== undefined) {
    if (typeof patch.favorite !== "boolean") throw new Error("Invalid favorite flag");
    item.favorite = patch.favorite;
  }
  if (patch.notes !== undefined) item.notes = patch.notes === null ? null : checkedNote(patch.notes);
  const login = { ...(item.login ?? {}) };
  if (patch.username !== undefined) {
    login.username = patch.username === null ? null : checkedString(patch.username, "username");
  }
  if (patch.password !== undefined) {
    login.password = patch.password === null ? null : checkedString(patch.password, "password");
  }
  if (patch.uris !== undefined) login.uris = checkedUriList(patch.uris);
  item.login = login;
  const changed = Object.keys(patch).some((key) => key !== "itemId");
  if (!changed) throw new Error("No item fields were supplied");
  if (Buffer.byteLength(JSON.stringify(item), "utf8") > MAX_ITEM_BYTES) throw new Error("Item is too large");
  return item;
}

export function encodeVaultItem(item: LoginVaultItem): string {
  const serialized = JSON.stringify(item);
  if (Buffer.byteLength(serialized, "utf8") > MAX_ITEM_BYTES) throw new Error("Item is too large");
  return Buffer.from(serialized, "utf8").toString("base64");
}

function parseMutationItem(stdout: string): SafeVaultItem {
  const raw = JSON.parse(stdout) as RawVaultItem;
  const safe = redactVaultItem(raw);
  if (!UUID.test(safe.id) || safe.name === "Unnamed item") throw new Error("Invalid item response");
  return safe;
}

export async function createLoginVaultItem(params: {
  runner: CliRunner;
  item: LoginItemInput;
}): Promise<SafeVaultItem> {
  const item = buildLoginVaultItem(params.item);
  const result = await params.runner(["create", "item"], encodeVaultItem(item));
  return parseMutationItem(result.stdout);
}

export async function updateLoginVaultItem(params: {
  runner: CliRunner;
  itemId: string;
  patch: LoginItemPatch;
}): Promise<SafeVaultItem> {
  const itemId = checkedId(params.itemId, "item ID");
  return withMutationLock(itemId, async () => {
    const current = await params.runner(["get", "item", itemId]);
    const item = mergeLoginVaultItem(JSON.parse(current.stdout), params.patch);
    const result = await params.runner(["edit", "item", itemId], encodeVaultItem(item));
    return parseMutationItem(result.stdout);
  });
}

export async function deleteLoginVaultItem(params: {
  runner: CliRunner;
  itemId: string;
}): Promise<{ id: string; deleted: true }> {
  const itemId = checkedId(params.itemId, "item ID");
  return withMutationLock(itemId, async () => {
    await params.runner(["delete", "item", itemId]);
    return { id: itemId, deleted: true };
  });
}

export type SafeVaultItem = {
  id: string;
  name: string;
  type?: number;
  folderId?: string | null;
  collectionIds?: string[];
  login?: { uris?: string[] };
};

export type SafeVaultObject = {
  id: string;
  name: string;
  organizationId?: string;
};

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

export function redactVaultItem(raw: RawVaultItem): SafeVaultItem {
  const item: SafeVaultItem = {
    id: stringValue(raw.id) ?? "unknown",
    name: stringValue(raw.name) ?? "Unnamed item",
  };
  if (typeof raw.type === "number") {
    item.type = raw.type;
  }
  if (raw.folderId === null || typeof raw.folderId === "string") {
    item.folderId = raw.folderId;
  }
  if (Array.isArray(raw.collectionIds)) {
    item.collectionIds = raw.collectionIds.filter(
      (value): value is string => typeof value === "string",
    );
  }
  if (raw.login && Array.isArray(raw.login.uris)) {
    const uris = raw.login.uris
      .map((entry) => stringValue(entry.uri))
      .filter((value): value is string => Boolean(value));
    if (uris.length > 0) {
      item.login = { uris };
    }
  }
  return item;
}

export function parseItemList(stdout: string, maxResults: number): SafeVaultItem[] {
  const parsed = JSON.parse(stdout) as unknown;
  if (!Array.isArray(parsed)) {
    throw new Error("Vaultwarden returned an invalid item list");
  }
  return parsed.slice(0, maxResults).map((item) => redactVaultItem(item as RawVaultItem));
}

export async function searchVaultItems(params: {
  runner: CliRunner;
  query: string;
  maxResults: number;
}): Promise<SafeVaultItem[]> {
  const result = await params.runner(["list", "items", "--search", params.query]);
  return parseItemList(result.stdout, params.maxResults);
}

export async function getVaultItem(params: {
  runner: CliRunner;
  itemId: string;
}): Promise<SafeVaultItem> {
  const result = await params.runner(["get", "item", params.itemId]);
  return redactVaultItem(JSON.parse(result.stdout) as RawVaultItem);
}

export function parseVaultObjects(stdout: string, maxResults: number): SafeVaultObject[] {
  const parsed = JSON.parse(stdout) as unknown;
  if (!Array.isArray(parsed)) {
    throw new Error("Vaultwarden returned an invalid object list");
  }
  return parsed.slice(0, maxResults).map((value) => {
    const raw = value as Record<string, unknown>;
    const object: SafeVaultObject = {
      id: stringValue(raw.id) ?? "unknown",
      name: stringValue(raw.name) ?? "Unnamed object",
    };
    const organizationId = stringValue(raw.organizationId);
    if (organizationId) {
      object.organizationId = organizationId;
    }
    return object;
  });
}

export async function listVaultObjects(params: {
  runner: CliRunner;
  object: "folders" | "collections";
  maxResults: number;
}): Promise<SafeVaultObject[]> {
  const result = await params.runner(["list", params.object]);
  return parseVaultObjects(result.stdout, params.maxResults);
}
