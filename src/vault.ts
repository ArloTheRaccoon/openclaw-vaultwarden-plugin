export type CliRunner = (args: string[]) => Promise<{ stdout: string; stderr: string }>;

type RawVaultItem = {
  id?: unknown;
  name?: unknown;
  type?: unknown;
  folderId?: unknown;
  collectionIds?: unknown;
  login?: { uris?: Array<{ uri?: unknown }> };
};

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
