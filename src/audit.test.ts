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
});
