import { describe, expect, it } from "vitest";
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
      env: { PATH: "/usr/bin", TEST_BW_SESSION: "test-session-token" },
      executor: async (_file, _args, options) => {
        commandEnv = options.env;
        return { stdout: JSON.stringify({ status: "unlocked" }), stderr: "" };
      },
    });

    await runner(["status"]);

    expect(commandEnv?.BW_SESSION).toBe("test-session-token");
  });
});
