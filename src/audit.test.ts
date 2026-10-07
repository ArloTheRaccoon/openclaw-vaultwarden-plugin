import { describe, expect, it } from "vitest";
import { emitVaultwardenAudit } from "./audit.js";

describe("Vaultwarden audit events", () => {
  it("contains only operation and outcome metadata", () => {
    const events: unknown[] = [];
    emitVaultwardenAudit(events.push.bind(events) as never, "search", "success");
    expect(events).toEqual([
      { event: "vaultwarden.tool", operation: "search", outcome: "success" },
    ]);
  });

  it("does not let an audit sink failure break a tool", () => {
    expect(() =>
      emitVaultwardenAudit(
        () => {
          throw new Error("sink failure");
        },
        "status",
        "error",
      ),
    ).not.toThrow();
  });

  it("keeps only valid item identifiers and never forwards arbitrary values", () => {
    const events: unknown[] = [];
    emitVaultwardenAudit(events.push.bind(events) as never, "update_item", "success", "not-a-secret");
    emitVaultwardenAudit(
      events.push.bind(events) as never,
      "update_item",
      "success",
      "9a7e20c6-4aed-4e81-88af-048f7d99b013",
    );
    expect(events).toEqual([
      { event: "vaultwarden.tool", operation: "update_item", outcome: "success" },
      { event: "vaultwarden.tool", operation: "update_item", outcome: "success", itemId: "9a7e20c6-4aed-4e81-88af-048f7d99b013" },
    ]);
  });
});
