import { Type } from "typebox";
import { textResult } from "openclaw/plugin-sdk/tool-results";
import { emitVaultwardenAudit, type VaultwardenAuditSink } from "./audit.js";
import { redactCliError } from "./cli.js";
import { getVaultItem, listVaultObjects, searchVaultItems, type CliRunner } from "./vault.js";

function jsonToolResult(value: unknown) {
  return textResult(JSON.stringify(value), value);
}

function errorToolResult(error: unknown) {
  return Object.assign(textResult(redactCliError(error), { error: true }), { isError: true });
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
