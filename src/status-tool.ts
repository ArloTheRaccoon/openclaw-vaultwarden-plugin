import { Type } from "typebox";
import { textResult } from "openclaw/plugin-sdk/tool-results";
import { emitVaultwardenAudit, type VaultwardenAuditSink } from "./audit.js";
import type { CliRunner } from "./cli.js";
import { parseBwStatus, redactCliError } from "./cli.js";

export function createVaultwardenStatusTool(runner: CliRunner, audit?: VaultwardenAuditSink) {
  return {
    name: "vaultwarden_status",
    label: "Vaultwarden Status",
    description:
      "Check Vaultwarden connectivity, authentication, and lock state without returning vault contents or credentials.",
    parameters: Type.Object({}, { additionalProperties: false }),
    execute: async () => {
      try {
        const result = await runner(["status"]);
        const status = parseBwStatus(result.stdout);
        emitVaultwardenAudit(audit, "status", "success");
        return textResult(JSON.stringify(status), status);
      } catch (error) {
        emitVaultwardenAudit(audit, "status", "error");
        return Object.assign(textResult(redactCliError(error), { error: true }), { isError: true });
      }
    },
  };
}
