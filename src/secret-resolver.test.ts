import { chmodSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { runResolverProtocol } from "./secret-resolver-protocol.js";
import { describe, expect, it, vi } from "vitest";
import { resolveSecretRequest } from "./secret-resolver.js";

const itemId = "123e4567-e89b-42d3-a456-426614174000";
const session = "synthetic-session-value";

describe("Vaultwarden SecretRef resolver", () => {
  it("speaks protocolVersion 1 JSON on the exec resolver boundary", async () => {
    const result = await runResolverProtocol(
      JSON.stringify({ protocolVersion: 1, ids: [itemId + "/password"] }),
      {
        env: { BW_SESSION: session },
        getItem: async () => ({ id: itemId, login: { password: "synthetic-password" } }),
      },
    );
    expect(JSON.parse(result)).toEqual({
      protocolVersion: 1,
      values: { [itemId + "/password"]: "synthetic-password" },
      errors: {},
    });
  });

  it("declares the managed Node exec integration and packages its resolver", () => {
    const manifest = JSON.parse(readFileSync(new URL("../openclaw.plugin.json", import.meta.url), "utf8")) as {
      secretProviderIntegrations?: Record<string, Record<string, unknown>>;
    };
    const preset = manifest.secretProviderIntegrations?.vaultwarden;
    expect(preset).toMatchObject({
      displayName: "Vaultwarden",
      source: "exec",
      command: "${node}",
      args: ["./dist/secret-resolver.mjs"],
      passEnv: ["BW_SESSION", "VAULTWARDEN_SESSION_FILE"],
      jsonOnly: true,
    });
  });

  it("returns only the explicitly selected login password", async () => {
    const getItem = vi.fn(async () => ({
      id: itemId,
      login: { username: "not-returned@example.test", password: "synthetic-password" },
      notes: "also-not-returned",
    }));

    const result = await resolveSecretRequest(
      JSON.stringify({ protocolVersion: 1, ids: [`${itemId}/password`] }),
      { env: { BW_SESSION: session }, getItem },
    );

    expect(result).toEqual({ protocolVersion: 1, values: { [`${itemId}/password`]: "synthetic-password" }, errors: {} });
    expect(getItem).toHaveBeenCalledWith(itemId, session);
  });

  it("returns an explicitly named text or hidden custom field and rejects ambiguous matches", async () => {
    const getItem = vi.fn(async () => ({
      id: itemId,
      login: { password: "synthetic-password" },
      fields: [
        { name: "api token", type: 0, value: "synthetic-text-field" },
        { name: "hidden token", type: 1, value: "synthetic-hidden-field" },
        { name: "flag", type: 2, value: "true" },
        { name: "duplicate", type: 0, value: "one" },
        { name: "duplicate", type: 1, value: "two" },
      ],
    }));
    const result = await resolveSecretRequest(
      JSON.stringify({
        protocolVersion: 1,
        ids: [`${itemId}/field/api token`, `${itemId}/field/hidden token`, `${itemId}/field/flag`, `${itemId}/field/duplicate`],
      }),
      { env: { BW_SESSION: session }, getItem },
    );

    expect(result.values).toEqual({
      [`${itemId}/field/api token`]: "synthetic-text-field",
      [`${itemId}/field/hidden token`]: "synthetic-hidden-field",
    });
    expect(result.errors).toEqual({
      [`${itemId}/field/flag`]: "Unable to resolve secret",
      [`${itemId}/field/duplicate`]: "Unable to resolve secret",
    });
    expect(getItem).toHaveBeenCalledTimes(1);
  });

  it.each([
    "not-json",
    JSON.stringify({ protocolVersion: 1, ids: [itemId + "/password"], padding: "x".repeat(64 * 1024) }),
    JSON.stringify({ protocolVersion: 2, ids: [`${itemId}/password`] }),
    JSON.stringify({ protocolVersion: 1, ids: [`${itemId}/username`] }),
    JSON.stringify({ protocolVersion: 1, ids: [`${itemId}/field/../password`] }),
    JSON.stringify({ protocolVersion: 1, ids: Array.from({ length: 21 }, () => `${itemId}/password`) }),
  ])("fails closed for malformed or unsupported resolver input", async (input) => {
    const getItem = vi.fn();
    const result = await resolveSecretRequest(input, { env: { BW_SESSION: session }, getItem });
    expect(result.values).toEqual({});
    expect(Object.keys(result.errors).length).toBeGreaterThan(0);
    expect(getItem).not.toHaveBeenCalled();
  });

  it("does not include CLI failures or output in resolver errors", async () => {
    const result = await resolveSecretRequest(
      JSON.stringify({ protocolVersion: 1, ids: [`${itemId}/password`] }),
      {
        env: { BW_SESSION: session },
        getItem: async () => { throw new Error("synthetic-secret-leak"); },
      },
    );
    expect(result.errors).toEqual({ [`${itemId}/password`]: "Unable to resolve secret" });
    expect(JSON.stringify(result)).not.toContain("synthetic-secret-leak");
  });

  it("rejects oversized stdout payloads without returning a partial secret batch", async () => {
    const ids = ["first", "second", "third"].map((name) => itemId + "/field/" + name);
    const value = "x".repeat(24 * 1024);
    const result = await resolveSecretRequest(
      JSON.stringify({ protocolVersion: 1, ids }),
      {
        env: { BW_SESSION: session },
        getItem: async () => ({
          id: itemId,
          fields: ids.map((id) => ({ name: id.split("/").at(-1), type: 0, value })),
        }),
      },
    );
    expect(result.values).toEqual({});
    expect(result.errors).toEqual(Object.fromEntries(ids.map((id) => [id, "Unable to resolve secret"])));
  });

  it("reads the protected session file convention when BW_SESSION is not passed", async () => {
    const home = mkdtempSync(join(tmpdir(), "vaultwarden-resolver-"));
    const sessionPath = join(home, ".openclaw", "secrets", "vaultwarden-session");
    const { mkdirSync } = await import("node:fs");
    mkdirSync(join(home, ".openclaw", "secrets"), { recursive: true, mode: 0o700 });
    writeFileSync(sessionPath, `${session}\n`, { mode: 0o600 });
    const getItem = vi.fn(async () => ({ id: itemId, login: { password: "synthetic-password" } }));

    const result = await resolveSecretRequest(
      JSON.stringify({ protocolVersion: 1, ids: [`${itemId}/password`] }),
      { env: {}, homeDirectory: home, getItem },
    );

    expect(result.values[`${itemId}/password`]).toBe("synthetic-password");
    expect(getItem).toHaveBeenCalledWith(itemId, session);
  });

  it("supports the explicit protected session file override", async () => {
    const dir = mkdtempSync(join(tmpdir(), "vaultwarden-resolver-"));
    const path = join(dir, "custom-session");
    writeFileSync(path, session + "\n", { mode: 0o600 });
    const getItem = vi.fn(async () => ({ id: itemId, login: { password: "synthetic-password" } }));
    const result = await resolveSecretRequest(
      JSON.stringify({ protocolVersion: 1, ids: [itemId + "/password"] }),
      { env: { VAULTWARDEN_SESSION_FILE: path }, homeDirectory: dir, getItem },
    );
    expect(result.values[itemId + "/password"]).toBe("synthetic-password");
    expect(getItem).toHaveBeenCalledWith(itemId, session);
  });

  it("rejects a session file not owned by the OpenClaw user", async () => {
    const home = mkdtempSync(join(tmpdir(), "vaultwarden-resolver-"));
    const dir = join(home, ".openclaw", "secrets");
    const { mkdirSync } = await import("node:fs");
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    writeFileSync(join(dir, "vaultwarden-session"), session + "\n", { mode: 0o600 });
    const getuid = vi.spyOn(process, "getuid").mockReturnValue((process.getuid?.() ?? 0) + 1);
    try {
      const result = await resolveSecretRequest(
        JSON.stringify({ protocolVersion: 1, ids: [itemId + "/password"] }),
        { env: {}, homeDirectory: home, getItem: async () => ({ id: itemId, login: { password: "synthetic" } }) },
      );
      expect(result.values).toEqual({});
      expect(result.errors).toEqual({ [itemId + "/password"]: "Unable to resolve secret" });
    } finally {
      getuid.mockRestore();
    }
  });

  it.each(["empty", "oversized", "symlink", "unsafe-mode", "extra-blank-line"]) (
    "fails closed for %s session files",
    async (kind) => {
      const home = mkdtempSync(join(tmpdir(), "vaultwarden-resolver-"));
      const dir = join(home, ".openclaw", "secrets");
      const { mkdirSync } = await import("node:fs");
      mkdirSync(dir, { recursive: true, mode: 0o700 });
      const path = join(dir, "vaultwarden-session");
      if (kind === "empty") writeFileSync(path, "", { mode: 0o600 });
      if (kind === "oversized") writeFileSync(path, "x".repeat(4097), { mode: 0o600 });
      if (kind === "unsafe-mode") {
        writeFileSync(path, `${session}\n`, { mode: 0o640 });
        chmodSync(path, 0o640);
      }
      if (kind === "extra-blank-line") writeFileSync(path, session + "\n\n", { mode: 0o600 });
      if (kind === "symlink") {
        const target = join(dir, "target");
        writeFileSync(target, `${session}\n`, { mode: 0o600 });
        symlinkSync(target, path);
      }
      const getItem = vi.fn(async () => ({ id: itemId, login: { password: "synthetic-password" } }));
      const result = await resolveSecretRequest(
        JSON.stringify({ protocolVersion: 1, ids: [`${itemId}/password`] }),
        { env: {}, homeDirectory: home, getItem },
      );
      expect(result.values).toEqual({});
      expect(result.errors).toEqual({ [`${itemId}/password`]: "Unable to resolve secret" });
      expect(getItem).not.toHaveBeenCalled();
    },
  );
});
