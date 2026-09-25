import { Type } from "typebox";
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
        emitVaultwardenAudit(audit, "status", "success");
        return {
          content: [{ type: "text", text: JSON.stringify(parseBwStatus(result.stdout)) }],
        };
      } catch (error) {
        emitVaultwardenAudit(audit, "status", "error");
        return {
          content: [{ type: "text", text: redactCliError(error) }],
          isError: true,
        };
      }
    },
  };
}
