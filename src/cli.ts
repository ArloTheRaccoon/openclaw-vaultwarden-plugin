import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type BwStatus = {
  serverUrl?: string;
  status?: "unauthenticated" | "locked" | "unlocked" | string;
};

export type CliResult = { stdout: string; stderr: string };
export type CliRunner = (args: string[]) => Promise<CliResult>;

export function parseBwStatus(stdout: string): BwStatus {
  const parsed = JSON.parse(stdout) as Record<string, unknown>;
  return {
    serverUrl: typeof parsed.serverUrl === "string" ? parsed.serverUrl : undefined,
    status: typeof parsed.status === "string" ? parsed.status : undefined,
  };
}

export function redactCliError(_error: unknown): string {
  return "Vaultwarden CLI command failed";
}

export function createBitwardenCliRunner(params?: {
  sessionEnv?: string;
  timeoutSeconds?: number;
  env?: NodeJS.ProcessEnv;
}): CliRunner {
  const sessionEnv = params?.sessionEnv ?? "BW_SESSION";
  const timeout = (params?.timeoutSeconds ?? 15) * 1_000;
  const inherited = params?.env ?? process.env;
  const env: NodeJS.ProcessEnv = {
    PATH: inherited.PATH,
  };
  for (const key of [sessionEnv, "BITWARDENCLI_APPDATA_DIR", "NODE_EXTRA_CA_CERTS"]) {
    if (inherited[key]) {
      env[key] = inherited[key];
    }
  }

  return async (args) => {
    const result = await execFileAsync("bw", args, {
      env,
      timeout,
      maxBuffer: 2 * 1024 * 1024,
    });
    return { stdout: result.stdout, stderr: result.stderr };
  };
}
