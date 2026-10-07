export type VaultwardenAuditEvent = {
  event: "vaultwarden.tool";
  operation: string;
  outcome: "success" | "error";
  itemId?: string;
};

export type VaultwardenAuditSink = (event: VaultwardenAuditEvent) => void;

export function emitVaultwardenAudit(
  audit: VaultwardenAuditSink | undefined,
  operation: string,
  outcome: VaultwardenAuditEvent["outcome"],
  itemId?: string,
): void {
  if (!audit) {
    return;
  }
  try {
    const safeItemId = itemId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(itemId)
      ? itemId
      : undefined;
    audit({ event: "vaultwarden.tool", operation, outcome, ...(safeItemId ? { itemId: safeItemId } : {}) });
  } catch {
    // Audit delivery must never turn a safe read-only tool into a failure.
  }
}
