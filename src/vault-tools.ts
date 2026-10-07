import { Type } from "typebox";
import { textResult } from "openclaw/plugin-sdk/tool-results";
import { emitVaultwardenAudit, type VaultwardenAuditSink } from "./audit.js";
import { redactCliError } from "./cli.js";
import {
  createLoginVaultItem,
  deleteLoginVaultItem,
  getVaultItem,
  listVaultObjects,
  searchVaultItems,
  updateLoginVaultItem,
  type CliRunner,
  type LoginItemInput,
  type LoginItemPatch,
} from "./vault.js";

function jsonToolResult(value: unknown) {
  return textResult(JSON.stringify(value), value);
}

function errorToolResult(error: unknown) {
  return Object.assign(textResult(redactCliError(error), { error: true }), { isError: true });
}

const UUID_PATTERN = "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$";
const uuidSchema = Type.String({ pattern: UUID_PATTERN });
const itemIdSchema = Type.String({ pattern: UUID_PATTERN, description: "Exact Vaultwarden item UUID." });
const optionalText = (description: string) =>
  Type.Optional(Type.String({ maxLength: 24_576, description }));
const optionalNullableText = (description: string) =>
  Type.Optional(Type.Union([Type.String({ maxLength: 24_576, description }), Type.Null()]));
const uriArray = Type.Array(Type.String({ minLength: 1, maxLength: 4096 }), { maxItems: 100 });
const fieldArray = Type.Array(
  Type.Object(
    {
      name: Type.String({ minLength: 1, maxLength: 256 }),
      value: Type.String({ minLength: 1, maxLength: 24_576, description: "Stored in the vault; never returned by this tool." }),
      type: Type.Optional(Type.Union([Type.Literal("hidden"), Type.Literal("text")])),
    },
    { additionalProperties: false },
  ),
  { maxItems: 100 },
);
const loginItemFields = {
  name: Type.String({ minLength: 1, maxLength: 256, description: "Vault item name." }),
  username: optionalText("Stored in the vault; not returned by plugin read tools."),
  password: optionalText("Stored in the vault; never returned by this tool."),
  uris: Type.Optional(uriArray),
  notes: optionalText("Stored in the vault; never returned by this tool."),
  folderId: Type.Optional(Type.Union([Type.String({ pattern: UUID_PATTERN }), Type.Null()])),
  collectionIds: Type.Optional(Type.Array(uuidSchema, { maxItems: 100 })),
  fields: Type.Optional(fieldArray),
  favorite: Type.Optional(Type.Boolean()),
};

export function createVaultwardenCreateItemTool(runner: CliRunner, audit?: VaultwardenAuditSink) {
  return {
    name: "vaultwarden_create_item",
    label: "Vaultwarden Create Login Item",
    description:
      "Create one login item when mutations are enabled. Secret fields are sent to the local Bitwarden CLI over stdin and are never returned or audited. Use only when explicitly requested.",
    parameters: Type.Object(loginItemFields, { additionalProperties: false }),
    execute: async (_id: string, params: LoginItemInput) => {
      try {
        const result = await createLoginVaultItem({ runner, item: params });
        emitVaultwardenAudit(audit, "create_item", "success");
        return jsonToolResult(result);
      } catch (error) {
        emitVaultwardenAudit(audit, "create_item", "error");
        return errorToolResult(error);
      }
    },
  };
}

export function createVaultwardenUpdateItemTool(runner: CliRunner, audit?: VaultwardenAuditSink) {
  const patchFields = {
    name: Type.Optional(Type.String({ minLength: 1, maxLength: 256 })),
    username: optionalNullableText("Replace username; null clears it, omitted fields remain unchanged."),
    password: optionalNullableText("Replace password; null clears it, and it is never returned by this tool."),
    uris: Type.Optional(uriArray),
    notes: optionalNullableText("Replace notes; null clears them, and they are never returned by this tool."),
    folderId: Type.Optional(Type.Union([Type.String({ pattern: UUID_PATTERN }), Type.Null()])),
    collectionIds: Type.Optional(Type.Array(uuidSchema, { maxItems: 100 })),
    fields: Type.Optional(fieldArray),
    favorite: Type.Optional(Type.Boolean()),
  };
  return {
    name: "vaultwarden_update_item",
    label: "Vaultwarden Update Login Item",
    description:
      "Update supplied fields on one exact login item. Unspecified fields are preserved. Secret fields are sent to the local Bitwarden CLI over stdin and are never returned or audited. Use only when explicitly requested.",
    parameters: Type.Object(
      { itemId: itemIdSchema, ...patchFields },
      { additionalProperties: false },
    ),
    execute: async (_id: string, params: { itemId: string } & LoginItemPatch) => {
      try {
        const { itemId, ...patch } = params;
        const result = await updateLoginVaultItem({ runner, itemId, patch });
        emitVaultwardenAudit(audit, "update_item", "success", itemId);
        return jsonToolResult(result);
      } catch (error) {
        emitVaultwardenAudit(audit, "update_item", "error", params.itemId);
        return errorToolResult(error);
      }
    },
  };
}

export function createVaultwardenDeleteItemTool(runner: CliRunner, audit?: VaultwardenAuditSink) {
  return {
    name: "vaultwarden_delete_item",
    label: "Vaultwarden Delete Login Item",
    description:
      "Soft-delete one login item. Requires confirmation equal to the exact item UUID; hard/permanent deletion is not supported. Use only when explicitly requested.",
    parameters: Type.Object(
      {
        itemId: itemIdSchema,
        confirmation: Type.String({ minLength: 1, description: "Must exactly match itemId." }),
      },
      { additionalProperties: false },
    ),
    execute: async (_id: string, params: { itemId: string; confirmation: string }) => {
      try {
        if (params.confirmation !== params.itemId) throw new Error("Confirmation mismatch");
        const result = await deleteLoginVaultItem({ runner, itemId: params.itemId });
        emitVaultwardenAudit(audit, "delete_item", "success", params.itemId);
        return jsonToolResult(result);
      } catch (error) {
        emitVaultwardenAudit(audit, "delete_item", "error", params.itemId);
        return errorToolResult(error);
      }
    },
  };
}

export function createVaultwardenMutationTools(
  runner: CliRunner,
  enabled: unknown,
  audit?: VaultwardenAuditSink,
) {
  if (enabled !== true) return [];
  return [
    createVaultwardenCreateItemTool(runner, audit),
    createVaultwardenUpdateItemTool(runner, audit),
    createVaultwardenDeleteItemTool(runner, audit),
  ];
}

export function createVaultwardenSearchTool(
  runner: CliRunner,
  maxResults: number,
  audit?: VaultwardenAuditSink,
) {
  return {
    name: "vaultwarden_search",
    label: "Vaultwarden Search",
    description:
      "Search Vaultwarden item metadata without returning passwords, TOTP seeds, or secure notes.",
    parameters: Type.Object(
      { query: Type.String({ minLength: 1, description: "Item name or metadata to search for." }) },
      { additionalProperties: false },
    ),
    execute: async (_id: string, params: { query: string }) => {
      try {
        const result = await searchVaultItems({ runner, query: params.query, maxResults });
        emitVaultwardenAudit(audit, "search", "success");
        return jsonToolResult(result);
      } catch (error) {
        emitVaultwardenAudit(audit, "search", "error");
        return errorToolResult(error);
      }
    },
  };
}

export function createVaultwardenGetItemTool(runner: CliRunner, audit?: VaultwardenAuditSink) {
  return {
    name: "vaultwarden_get_item",
    label: "Vaultwarden Get Item",
    description: "Retrieve one Vaultwarden item by ID, returning safe metadata only.",
    parameters: Type.Object(
      { itemId: Type.String({ minLength: 1, description: "Stable Vaultwarden item ID." }) },
      { additionalProperties: false },
    ),
    execute: async (_id: string, params: { itemId: string }) => {
      try {
        const result = await getVaultItem({ runner, itemId: params.itemId });
        emitVaultwardenAudit(audit, "get_item", "success");
        return jsonToolResult(result);
      } catch (error) {
        emitVaultwardenAudit(audit, "get_item", "error");
        return errorToolResult(error);
      }
    },
  };
}

function createListTool(
  runner: CliRunner,
  object: "folders" | "collections",
  maxResults: number,
  audit?: VaultwardenAuditSink,
) {
  const label = object === "folders" ? "Folders" : "Collections";
  return {
    name: `vaultwarden_list_${object}`,
    label: `Vaultwarden ${label}`,
    description: `List Vaultwarden ${object} metadata without returning vault item contents.`,
    parameters: Type.Object({}, { additionalProperties: false }),
    execute: async () => {
      try {
        const result = await listVaultObjects({ runner, object, maxResults });
        emitVaultwardenAudit(audit, `list_${object}`, "success");
        return jsonToolResult(result);
      } catch (error) {
        emitVaultwardenAudit(audit, `list_${object}`, "error");
        return errorToolResult(error);
      }
    },
  };
}

export function createVaultwardenListFoldersTool(
  runner: CliRunner,
  maxResults: number,
  audit?: VaultwardenAuditSink,
) {
  return createListTool(runner, "folders", maxResults, audit);
}

export function createVaultwardenListCollectionsTool(
  runner: CliRunner,
  maxResults: number,
  audit?: VaultwardenAuditSink,
) {
  return createListTool(runner, "collections", maxResults, audit);
}
