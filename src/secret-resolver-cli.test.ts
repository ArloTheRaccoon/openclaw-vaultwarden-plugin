import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runBitwardenGetItem } from "./secret-resolver-cli.js";

function childProcess() {
  const child = Object.assign(new EventEmitter(), {
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    kill: vi.fn(),
  });
  return child;
}

afterEach(() => vi.useRealTimers());

describe("SecretRef bw subprocess", () => {
  it("uses exact item lookup without a shell and only returns parsed stdout", async () => {
    const child = childProcess();
    const spawnProcess = vi.fn(() => child as never);
    const pending = runBitwardenGetItem(
      "123e4567-e89b-42d3-a456-426614174000",
      "synthetic-session",
      { spawnProcess: spawnProcess as never },
    );
    child.stdout.end('{"id":"synthetic-item","login":{"password":"synthetic-password"}}');
    child.emit("close", 0);

    await expect(pending).resolves.toEqual({ id: "synthetic-item", login: { password: "synthetic-password" } });
    expect(spawnProcess).toHaveBeenCalledWith(
      "bw",
      ["get", "item", "123e4567-e89b-42d3-a456-426614174000"],
      expect.objectContaining({
        shell: false,
        env: expect.objectContaining({ BW_SESSION: "synthetic-session" }),
        stdio: ["ignore", "pipe", "ignore"],
      }),
    );
  });

  it("hides CLI errors and enforces output and time limits", async () => {
    const failedChild = childProcess();
    const failed = runBitwardenGetItem(itemUuid, "synthetic-session", {
      spawnProcess: (() => failedChild) as never,
    });
    failedChild.stderr.end("synthetic-secret-leak");
    failedChild.emit("close", 1);
    await expect(failed).rejects.toThrow("Bitwarden item lookup failed");
    await expect(failed).rejects.not.toThrow("synthetic-secret-leak");

    const largeChild = childProcess();
    const large = runBitwardenGetItem(itemUuid, "synthetic-session", {
      spawnProcess: (() => largeChild) as never,
      maxOutputBytes: 12,
    });
    largeChild.stdout.write("x".repeat(13));
    await expect(large).rejects.toThrow("Bitwarden item lookup failed");
    expect(largeChild.kill).toHaveBeenCalled();
  });

  it("kills a CLI lookup that exceeds its deadline", async () => {
    vi.useFakeTimers();
    const child = childProcess();
    const result = runBitwardenGetItem(itemUuid, "synthetic-session", {
      spawnProcess: (() => child) as never,
      timeoutMs: 50,
    });
    const rejected = expect(result).rejects.toThrow("Bitwarden item lookup failed");
    await vi.advanceTimersByTimeAsync(51);
    await rejected;
    expect(child.kill).toHaveBeenCalledWith("SIGKILL");
  });
});

const itemUuid = "123e4567-e89b-42d3-a456-426614174000";
