import { describe, expect, it } from "vitest";
import { redactCliError, parseBwStatus, type CliRunner } from "./cli.js";

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
});
