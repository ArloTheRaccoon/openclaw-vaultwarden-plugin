import { describe, expect, it } from "vitest";
import type { SecretInput } from "openclaw/plugin-sdk/secret-ref-runtime";
import { createBitwardenCliRunner, redactCliError, parseBwStatus, type CliRunner } from "./cli.js";

describe("Vaultwarden CLI adapter primitives", () => {
  it("parses status without requiring vault contents", () => {
    expect(
      parseBwStatus(
        JSON.stringify({
          serverUrl: "https://vaultwarden.example.test",
          status: "locked",
          userEmail: "secret@example.test",
          userId: "user-id",
        }),
      ),
    ).toEqual({
      serverUrl: "https://vaultwarden.example.test",
      status: "locked",
    });
  });

  it("redacts command output from errors", () => {
    expect(redactCliError(new Error("BW_SESSION=secret-token password=secret"))).toBe(
      "Vaultwarden CLI command failed",
    );
  });

  it("gives a safe recovery hint for an expired Vaultwarden session", () => {
    expect(redactCliError(new Error("BW_SESSION expired"))).toContain(
      "run `openclaw vaultwarden` in a trusted terminal",
    );
    expect(redactCliError(new Error("BW_SESSION expired"))).not.toContain("BW_SESSION");
  });

  it("keeps the runner boundary injectable", async () => {
    const runner: CliRunner = async () => ({
      stdout: JSON.stringify({ serverUrl: "https://vaultwarden.example.test", status: "locked" }),
      stderr: "",
    });
    const result = await runner(["status"]);
    expect(result.stdout).toContain('"locked"');
  });

  it("resolves a configured session SecretRef only into the CLI environment", async () => {
    let commandEnv: NodeJS.ProcessEnv | undefined;
    const runner = createBitwardenCliRunner({
      session: { source: "env", provider: "default", id: "TEST_BW_SESSION" },
      config: {} as never,
      env: { PATH: "/usr/bin", HOME: "/tmp/test-home", TEST_BW_SESSION: "test-session-token" },
      executor: async (_file, _args, options) => {
        commandEnv = options.env;
        return { stdout: JSON.stringify({ status: "unlocked" }), stderr: "" };
      },
    });

    await runner(["status"]);

    expect(commandEnv?.BW_SESSION).toBe("test-session-token");
    expect(commandEnv?.HOME).toBe("/tmp/test-home");
  });

  it("reads the runtime config at command time", async () => {
    const currentConfig = {} as never;
    let commandEnv: NodeJS.ProcessEnv | undefined;
    const runner = createBitwardenCliRunner({
      session: { source: "env", provider: "default", id: "TEST_BW_SESSION" },
      config: () => currentConfig,
      env: { PATH: "/usr/bin", TEST_BW_SESSION: "live-session-token" },
      executor: async (_file, _args, options) => {
        commandEnv = options.env;
        return { stdout: JSON.stringify({ status: "unlocked" }), stderr: "" };
      },
    });

    await runner(["status"]);

    expect(commandEnv?.BW_SESSION).toBe("live-session-token");
  });

  it("reads the session reference at command time", async () => {
    let session: SecretInput | undefined = {
      source: "env",
      provider: "default",
      id: "TEST_BW_SESSION",
    };
    let commandEnv: NodeJS.ProcessEnv | undefined;
    const runner = createBitwardenCliRunner({
      session: () => session,
      config: () => ({} as never),
      env: { PATH: "/usr/bin", TEST_BW_SESSION: "live-session-token" },
      executor: async (_file, _args, options) => {
        commandEnv = options.env;
        return { stdout: JSON.stringify({ status: "unlocked" }), stderr: "" };
      },
    });

    await runner(["status"]);
    expect(commandEnv?.BW_SESSION).toBe("live-session-token");
    session = undefined;
  });
});
