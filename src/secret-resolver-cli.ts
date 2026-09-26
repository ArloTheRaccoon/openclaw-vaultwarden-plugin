import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { homedir } from "node:os";

const MAX_ITEM_OUTPUT_BYTES = 1024 * 1024;
const CLI_TIMEOUT_MS = 10_000;

export type ResolverItem = {
  id?: unknown;
  login?: { password?: unknown };
  fields?: Array<{ name?: unknown; type?: unknown; value?: unknown }>;
};

type SpawnOptions = {
  spawnProcess?: typeof spawn;
  timeoutMs?: number;
  maxOutputBytes?: number;
};

export function runBitwardenGetItem(
  itemId: string,
  session: string,
  options: SpawnOptions = {},
): Promise<ResolverItem> {
  return new Promise((resolve, reject) => {
    const fail = () => reject(new Error("Bitwarden item lookup failed"));
    let child: ChildProcess;
    try {
      child = (options.spawnProcess ?? spawn)(
        "bw",
        ["get", "item", itemId],
        {
          shell: false,
          env: {
            PATH: process.env.PATH ?? "/usr/bin:/bin",
            HOME: process.env.HOME ?? homedir(),
            ...(process.env.TMPDIR ? { TMPDIR: process.env.TMPDIR } : {}),
            ...(process.env.BITWARDENCLI_APPDATA_DIR
              ? { BITWARDENCLI_APPDATA_DIR: process.env.BITWARDENCLI_APPDATA_DIR }
              : {}),
            BW_SESSION: session,
          },
          stdio: ["ignore", "pipe", "ignore"],
        },
      );
    } catch {
      fail();
      return;
    }

    const chunks: Buffer[] = [];
    let outputBytes = 0;
    let settled = false;
    const finishError = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fail();
    };
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finishError();
    }, options.timeoutMs ?? CLI_TIMEOUT_MS);

    child.stdout?.on("data", (chunk: Buffer | string) => {
      const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      outputBytes += data.length;
      if (outputBytes > (options.maxOutputBytes ?? MAX_ITEM_OUTPUT_BYTES)) {
        child.kill("SIGKILL");
        finishError();
        return;
      }
      chunks.push(data);
    });
    child.on("error", finishError);
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code !== 0) {
        fail();
        return;
      }
      try {
        const item: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error("invalid item");
        resolve(item as ResolverItem);
      } catch {
        fail();
      }
    });
  });
}
