import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import type { SecretInput } from "openclaw/plugin-sdk/config-contracts";
import { getRuntimeConfig } from "openclaw/plugin-sdk/runtime-config-snapshot";
import { emitVaultwardenAudit, type VaultwardenAuditEvent } from "./src/audit.js";
import { registerVaultwardenAuthCli } from "./src/auth-cli.js";
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
    api.registerCli?.(({ program }) => registerVaultwardenAuthCli(program), {
      commands: ["vaultwarden"],
    });
    const config = api.pluginConfig as {
      sessionEnv?: string;
      session?: SecretInput;
      timeoutSeconds?: number;
      maxResults?: number;
    };
    const runner = createBitwardenCliRunner({
      ...config,
      session: () =>
        (getRuntimeConfig().plugins?.entries?.vaultwarden?.config as
          | { session?: SecretInput }
          | undefined)?.session,
      config: getRuntimeConfig,
      env: api.env,
    });
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
