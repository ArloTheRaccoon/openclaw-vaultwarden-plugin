import { describe, expect, it } from "vitest";
import {
  createVaultwardenCreateItemTool,
  createVaultwardenDeleteItemTool,
  createVaultwardenMutationTools,
  createVaultwardenUpdateItemTool,
} from "./vault-tools.js";
import type { CliRunner } from "./vault.js";

const itemId = "9a7e20c6-4aed-4e81-88af-048f7d99b013";

function encodedPayload(stdin: string | undefined) {
  if (!stdin) throw new Error("Expected a stdin payload");
  return JSON.parse(Buffer.from(stdin, "base64").toString("utf8")) as Record<string, unknown>;
}

describe("Vaultwarden mutation tools", () => {
  it("does not register writes unless the opt-in flag is exactly true", () => {
    const runner: CliRunner = async () => ({ stdout: "", stderr: "" });
    expect(createVaultwardenMutationTools(runner, false)).toEqual([]);
    expect(createVaultwardenMutationTools(runner, "true")).toEqual([]);
    expect(createVaultwardenMutationTools(runner, true).map((tool) => tool.name)).toEqual([
      "vaultwarden_create_item",
      "vaultwarden_update_item",
      "vaultwarden_delete_item",
    ]);
  });

  it("creates a single login item over stdin and returns metadata only", async () => {
    const calls: Array<{ args: string[]; stdin?: string }> = [];
    const events: unknown[] = [];
    const runner: CliRunner = async (args, stdin) => {
      calls.push({ args, stdin });
      return {
        stdout: JSON.stringify({
          id: itemId,
          type: 1,
          name: "Service token",
          login: { username: "private-user", password: "private-password", uris: [] },
          notes: "private-notes",
        }),
        stderr: "",
      };
    };

    const result = await createVaultwardenCreateItemTool(runner, (event) => events.push(event)).execute("call", {
      name: "Service token",
      username: "private-user",
      password: "private-password",
      notes: "private-notes",
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.args).toEqual(["create", "item"]);
    expect(JSON.stringify(calls[0]?.args)).not.toContain("private-password");
    expect(encodedPayload(calls[0]?.stdin).login).toEqual({ username: "private-user", password: "private-password" });
    expect(JSON.stringify(result)).not.toContain("private-user");
    expect(JSON.stringify(result)).not.toContain("private-password");
    expect(JSON.stringify(result)).not.toContain("private-notes");
    expect(events).toEqual([{ event: "vaultwarden.tool", operation: "create_item", outcome: "success" }]);
  });

  it("merges updates with the existing login item and never returns its secrets", async () => {
    const calls: Array<{ args: string[]; stdin?: string }> = [];
    const runner: CliRunner = async (args, stdin) => {
      calls.push({ args, stdin });
      if (args[0] === "get") {
        return {
          stdout: JSON.stringify({
            id: itemId,
            type: 1,
            name: "Service token",
            notes: "existing-note",
            login: { username: "existing-user", password: "existing-password", uris: [] },
            fields: [{ name: "preserved-field", value: "preserved-secret", type: "hidden" }],
          }),
          stderr: "",
        };
      }
      return {
        stdout: JSON.stringify({
          id: itemId,
          type: 1,
          name: "Service token",
          notes: "existing-note",
          login: { username: "existing-user", password: "replacement-password", uris: [] },
        }),
        stderr: "",
      };
    };

    const result = await createVaultwardenUpdateItemTool(runner).execute("call", {
      itemId,
      password: "replacement-password",
    });

    expect(calls.map((call) => call.args)).toEqual([["get", "item", itemId], ["edit", "item", itemId]]);
    expect(JSON.stringify(calls[1]?.args)).not.toContain("replacement-password");
    expect(encodedPayload(calls[1]?.stdin).login).toEqual({
      username: "existing-user",
      password: "replacement-password",
      uris: [],
    });
    expect(encodedPayload(calls[1]?.stdin).notes).toBe("existing-note");
    expect(encodedPayload(calls[1]?.stdin).fields).toEqual([
      { name: "preserved-field", value: "preserved-secret", type: "hidden" },
    ]);
    expect(JSON.stringify(result)).not.toContain("existing-user");
    expect(JSON.stringify(result)).not.toContain("existing-password");
    expect(JSON.stringify(result)).not.toContain("replacement-password");
  });

  it("returns a redacted error and error audit when an update cannot read the item", async () => {
    const events: unknown[] = [];
    const runner: CliRunner = async () => {
      throw new Error("BW_SESSION expired: session-token-must-not-leak");
    };

    const result = await createVaultwardenUpdateItemTool(runner, (event) => events.push(event)).execute("call", {
      itemId,
      password: "replacement-password",
    });

    expect(result).toMatchObject({ isError: true });
    expect(JSON.stringify(result)).toContain("Vaultwarden session is expired");
    expect(JSON.stringify(result)).not.toContain("session-token-must-not-leak");
    expect(JSON.stringify(result)).not.toContain("replacement-password");
    expect(events).toEqual([{
      event: "vaultwarden.tool",
      operation: "update_item",
      outcome: "error",
      itemId,
    }]);
  });

  it("requires the exact item ID to confirm soft deletion", async () => {
    const calls: string[][] = [];
    const runner: CliRunner = async (args) => {
      calls.push(args);
      return { stdout: "", stderr: "" };
    };
    const tool = createVaultwardenDeleteItemTool(runner);

    const rejected = await tool.execute("call", { itemId, confirmation: "different-id" });
    expect(calls).toHaveLength(0);
    expect(JSON.stringify(rejected)).not.toContain("different-id");

    const deleted = await tool.execute("call", { itemId, confirmation: itemId });
    expect(calls).toEqual([["delete", "item", itemId]]);
    expect(JSON.stringify(deleted)).toContain('"deleted":true');
    expect(JSON.stringify(deleted)).not.toContain("permanent");
  });
});
