import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { emitVaultwardenAudit, type VaultwardenAuditEvent } from "./src/audit.js";
import { createBitwardenCliRunner } from "./src/cli.js";
import { createVaultwardenStatusTool } from "./src/status-tool.js";
import {
  createVaultwardenGetItemTool,
  createVaultwardenListCollectionsTool,
  createVaultwardenListFoldersTool,
  createVaultwardenSearchTool,
} from "./src/vault-tools.js";

export default definePluginEntry({
  id: "vaultwarden",
  name: "Vaultwarden",
  description: "Bitwarden-compatible Vaultwarden tools for OpenClaw",
  register(api) {
    const config = api.pluginConfig as {
      sessionEnv?: string;
      timeoutSeconds?: number;
      maxResults?: number;
    };
    const runner = createBitwardenCliRunner(config);
    const audit = (event: VaultwardenAuditEvent) => {
      api.logger.info(JSON.stringify(event));
    };
    api.registerTool(createVaultwardenStatusTool(runner, audit), { name: "vaultwarden_status" });
    api.registerTool(createVaultwardenSearchTool(runner, config.maxResults ?? 20, audit), {
      name: "vaultwarden_search",
    });
    api.registerTool(createVaultwardenGetItemTool(runner, audit), { name: "vaultwarden_get_item" });
    api.registerTool(createVaultwardenListFoldersTool(runner, config.maxResults ?? 20, audit), {
      name: "vaultwarden_list_folders",
    });
    api.registerTool(createVaultwardenListCollectionsTool(runner, config.maxResults ?? 20, audit), {
      name: "vaultwarden_list_collections",
    });
  },
});
