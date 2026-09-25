import { chmodSync, closeSync, mkdirSync, openSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";

type CliCommand = {
  description(text: string): CliCommand;
  option(flags: string, description: string, defaultValue?: string): CliCommand;
  action(handler: (options: { sessionFile?: string }) => void | Promise<void>): CliCommand;
};

type CliProgram = {
  command(name: string): CliCommand;
};

export type AuthCliOptions = {
  sessionFile?: string;
  unlock?: () => string;
  login?: () => void;
};

const defaultSessionFile = "~/.openclaw/secrets/vaultwarden-session";

function expandHome(path: string): string {
  return path.startsWith("~/") ? resolve(process.env.HOME ?? ".", path.slice(2)) : resolve(path);
}

export function storeSessionToken(token: string, file: string): string {
  const trimmed = token.trim();
  if (!trimmed) {
    throw new Error("Bitwarden CLI returned an empty session");
  }
  const target = expandHome(file);
  mkdirSync(dirname(target), { recursive: true, mode: 0o700 });
  const temp = `${target}.${process.pid}.tmp`;
  const fd = openSync(temp, "wx", 0o600);
  try {
    chmodSync(temp, 0o600);
    writeFileSync(fd, `${trimmed}\n`, { encoding: "utf8" });
  } finally {
    closeSync(fd);
  }
  renameSync(temp, target);
  return target;
}

function unlockWithBitwardenCli(): string {
  const result = spawnSync("bw", ["unlock", "--raw"], {
    stdio: ["inherit", "pipe", "inherit"],
    encoding: "utf8",
    maxBuffer: 64 * 1024,
  });
  if (result.error || result.status !== 0) {
    throw new Error("Bitwarden CLI unlock failed");
  }
  return result.stdout ?? "";
}

function loginWithBitwardenCli(): void {
  const result = spawnSync("bw", ["login"], { stdio: "inherit" });
  if (result.error || result.status !== 0) {
    throw new Error("Bitwarden CLI login failed");
  }
}

function isBitwardenLoggedIn(): boolean {
  const result = spawnSync("bw", ["status", "--raw"], {
    stdio: ["ignore", "pipe", "ignore"],
    encoding: "utf8",
    maxBuffer: 64 * 1024,
  });
  if (result.error || result.status !== 0) {
    return false;
  }
  try {
    const status = JSON.parse(result.stdout ?? "") as { status?: string };
    return status.status !== "unauthenticated";
  } catch {
    return false;
  }
}

export function registerVaultwardenAuthCli(
  program: CliProgram,
  options: AuthCliOptions = {},
): void {
  program
    .command("vaultwarden")
    .description("Configure a local Vaultwarden CLI session for OpenClaw")
    .option("--session-file <path>", "0600 file for the session token", defaultSessionFile)
    .action(async ({ sessionFile = defaultSessionFile }) => {
      try {
        if (!isBitwardenLoggedIn()) {
          (options.login ?? loginWithBitwardenCli)();
        }
        const target = storeSessionToken(
          (options.unlock ?? unlockWithBitwardenCli)(),
          sessionFile,
        );
        console.log(`Vaultwarden session stored at ${target}`);
        console.log(
          `Configure a file SecretRef: provider source=file, path=${target}, mode=singleValue, id=value`,
        );
        console.log(
          'Then set plugins.entries.vaultwarden.config.session to {"source":"file","provider":"vaultwarden_session","id":"value"}.',
        );
      } catch {
        console.error("Vaultwarden session setup failed");
        process.exitCode = 1;
      }
    });
}
