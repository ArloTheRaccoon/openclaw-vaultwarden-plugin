export type VaultwardenAuditEvent = {
  event: "vaultwarden.tool";
  operation: string;
  outcome: "success" | "error";
};

export type VaultwardenAuditSink = (event: VaultwardenAuditEvent) => void;

export function emitVaultwardenAudit(
  audit: VaultwardenAuditSink | undefined,
  operation: string,
  outcome: VaultwardenAuditEvent["outcome"],
): void {
  if (!audit) {
    return;
  }
  try {
    audit({ event: "vaultwarden.tool", operation, outcome });
  } catch {
    // Audit delivery must never turn a safe read-only tool into a failure.
  }
}
