import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import type { OpenClawConfig } from "openclaw/plugin-sdk/config-contracts";
import type { SecretInput } from "openclaw/plugin-sdk/secret-ref-runtime";
import { resolveConfiguredSecretInputString } from "openclaw/plugin-sdk/secret-input-runtime";

const execFileAsync = promisify(execFile);

export type BwStatus = {
  serverUrl?: string;
  status?: "unauthenticated" | "locked" | "unlocked" | string;
};

export type CliResult = { stdout: string; stderr: string };
export type CliRunner = (args: string[], stdin?: string) => Promise<CliResult>;
type CliExecutor = (
  file: string,
  args: string[],
  options: {
    env: NodeJS.ProcessEnv;
    timeout: number;
    maxBuffer: number;
    input?: string;
  },
) => Promise<CliResult>;

type CliExecutionOptions = {
  env: NodeJS.ProcessEnv;
  timeout: number;
  maxBuffer: number;
  input?: string;
};

function execWithInput(file: string, args: string[], options: CliExecutionOptions): Promise<CliResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, {
      env: options.env,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let outputBytes = 0;
    let failed = false;
    let timedOut = false;
    let overflow = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, options.timeout);
    const forceKill = setTimeout(() => child.kill("SIGKILL"), options.timeout + 1_000);
    forceKill.unref();

    const fail = (error: Error) => {
      if (failed) return;
      failed = true;
      clearTimeout(timeout);
      clearTimeout(forceKill);
      reject(error);
    };
    child.once("error", (error) => fail(error));
    child.stdout.on("data", (chunk: Buffer) => {
      outputBytes += chunk.length;
      if (outputBytes > options.maxBuffer) {
        overflow = true;
        child.kill("SIGTERM");
        return;
      }
      stdout.push(chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      outputBytes += chunk.length;
      if (outputBytes > options.maxBuffer) {
        overflow = true;
        child.kill("SIGTERM");
        return;
      }
      stderr.push(chunk);
    });
    child.once("close", (code, signal) => {
      clearTimeout(timeout);
      clearTimeout(forceKill);
      if (failed) return;
      const result = {
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
      };
      if (overflow) {
        fail(Object.assign(new Error("Vaultwarden CLI output exceeded its limit"), result));
      } else if (timedOut) {
        fail(Object.assign(new Error("Vaultwarden CLI command timed out"), result));
      } else if (code !== 0) {
        fail(Object.assign(new Error(`Vaultwarden CLI exited with ${signal ?? code ?? "unknown status"}`), result));
      } else {
        resolve(result);
      }
    });
    child.stdin.on("error", () => {
      // The command may close stdin early; its exit status is reported on close.
    });
    child.stdin.end(options.input ?? "", "utf8");
  });
}

export function parseBwStatus(stdout: string): BwStatus {
  const parsed = JSON.parse(stdout) as Record<string, unknown>;
  return {
    serverUrl: typeof parsed.serverUrl === "string" ? parsed.serverUrl : undefined,
    status: typeof parsed.status === "string" ? parsed.status : undefined,
  };
}

function cliErrorText(error: unknown): string {
  if (typeof error === "string") {
    return error;
  }
  if (!error || typeof error !== "object") {
    return "";
  }
  const details = error as { message?: unknown; stderr?: unknown };
  return [details.message, details.stderr]
    .filter((value): value is string => typeof value === "string")
    .join("\n");
}

type RecoverySource = "file" | "env" | "exec" | "store" | "inline" | "default";

function sessionRecoverySource(
  session: SecretInput | undefined,
  sessionEnv: string,
  inherited: NodeJS.ProcessEnv,
): RecoverySource {
  if (typeof session === "string") return "inline";
  if (session && typeof session === "object" && "source" in session) {
    const source = (session as { source?: unknown }).source;
    if (source === "file" || source === "env" || source === "exec" || source === "store") {
      return source;
    }
  }
  return inherited[sessionEnv] ? "env" : "default";
}

function recoveryInstruction(source: RecoverySource): string {
  const statusCheck = "First verify the host with `bw status --raw`;";
  switch (source) {
    case "file":
      return `${statusCheck} Refresh the file configured for the Vaultwarden SecretRef, then retry. For a single-value file provider, run \`openclaw vaultwarden --session-file <configured-path>\` in a trusted terminal; do not use that command on a JSON provider file.`;
    case "env":
      return `${statusCheck} Refresh the configured environment SecretRef in the Gateway's environment, then retry. \`openclaw vaultwarden\` writes a local file and does not replace an environment SecretRef.`;
    case "exec":
    case "store":
      return `${statusCheck} Refresh the configured SecretRef at its provider, then retry. \`openclaw vaultwarden\` writes a local file and does not update that provider.`;
    case "inline":
      return `${statusCheck} Replace the configured session value with a freshly unlocked session using a secure local configuration path; do not paste it into chat. \`openclaw vaultwarden\` writes a local file but does not change inline configuration.`;
    default:
      return `${statusCheck} On the OpenClaw host, run \`openclaw vaultwarden\` in a trusted terminal to create the default local session file, then configure the plugin session as a file SecretRef to that file and retry. The CLI does not read the file automatically.`;
  }
}

type ContextualCliError = Error & { stderr?: string; recoverySource?: RecoverySource };

const sessionFailurePattern =
  /(?:session|token|authentication|credential).{0,48}(?:expired|invalid|unauthori[sz]ed|rejected|not valid)|(?:expired|invalid|unauthori[sz]ed|rejected).{0,48}(?:session|token|credential)|not logged in|you are not logged in|vault is locked|vault must be unlocked|\b401\b/i;

export type SessionFailureKind = "expired" | "locked" | "unauthenticated" | "unavailable";

export function classifySessionFailure(error: unknown): SessionFailureKind | undefined {
  const text = cliErrorText(error);
  if (!sessionFailurePattern.test(text)) return undefined;
  if (/expired|session.*(?:invalid|not valid)|(?:invalid|not valid).*session/i.test(text)) {
    return "expired";
  }
  if (/vault (?:is )?locked|vault must be unlocked|locked/i.test(text)) return "locked";
  if (/not logged in|unauthenticated|\b401\b|unauthori[sz]ed/i.test(text)) {
    return "unauthenticated";
  }
  return "unavailable";
}

function sessionFailurePrefix(kind: SessionFailureKind): string {
  switch (kind) {
    case "locked":
      return "Vaultwarden vault is locked";
    case "unauthenticated":
      return "Vaultwarden authentication is unavailable";
    case "unavailable":
      return "Vaultwarden session could not be used";
    default:
      return "Vaultwarden session is expired";
  }
}

export function redactCliError(error: unknown): string {
  const failureKind = classifySessionFailure(error);
  if (failureKind) {
    const source =
      error && typeof error === "object" && "recoverySource" in error
        ? (error as ContextualCliError).recoverySource
        : undefined;
    return `${sessionFailurePrefix(failureKind)}. ${recoveryInstruction(source ?? "default")} The plugin will not prompt for or expose the master password.`;
  }
  return "Vaultwarden CLI command failed";
}

export function createBitwardenCliRunner(params?: {
  sessionEnv?: string;
  session?: SecretInput | (() => SecretInput | undefined);
  config?: OpenClawConfig | (() => OpenClawConfig);
  timeoutSeconds?: number;
  env?: NodeJS.ProcessEnv;
  executor?: CliExecutor;
  onSessionResolution?: (result: { configured: boolean; resolved: boolean; reason?: string }) => void;
}): CliRunner {
  const sessionEnv = params?.sessionEnv ?? "BW_SESSION";
  const timeout = (params?.timeoutSeconds ?? 15) * 1_000;
  const inherited = params?.env ?? process.env;
  const executor = params?.executor ?? (execFileAsync as unknown as CliExecutor);
  const env: NodeJS.ProcessEnv = {
    PATH: inherited.PATH,
  };
  for (const key of [
    "HOME",
    "USERPROFILE",
    "XDG_CONFIG_HOME",
    "XDG_DATA_HOME",
    sessionEnv,
    "BITWARDENCLI_APPDATA_DIR",
    "NODE_EXTRA_CA_CERTS",
  ]) {
    if (inherited[key]) {
      env[key] = inherited[key];
    }
  }

  return async (args, stdin) => {
    const commandEnv = { ...env };
    const config = typeof params?.config === "function" ? params.config() : params?.config;
    const session = typeof params?.session === "function" ? params.session() : params?.session;
    if (session !== undefined && config) {
      const resolved = await resolveConfiguredSecretInputString({
        config,
        env: inherited,
        value: session,
        path: "plugins.entries.vaultwarden.config.session",
      });
      if (resolved.value) {
        commandEnv[sessionEnv] = resolved.value;
      }
      params?.onSessionResolution?.({
        configured: true,
        resolved: Boolean(resolved.value),
        reason: resolved.unresolvedRefReason,
      });
    } else {
      params?.onSessionResolution?.({ configured: session !== undefined, resolved: false });
    }
    let result: CliResult;
    try {
      const executionOptions = {
        env: commandEnv,
        timeout,
        maxBuffer: 2 * 1024 * 1024,
        ...(stdin === undefined ? {} : { input: stdin }),
      };
      if (stdin === undefined) {
        result = await executor("bw", args, executionOptions);
      } else if (executor === (execFileAsync as unknown as CliExecutor)) {
        result = await execWithInput("bw", args, executionOptions);
      } else {
        result = await executor("bw", args, executionOptions);
      }
    } catch (error) {
      const details = error && typeof error === "object" ? error as { message?: unknown; stderr?: unknown } : {};
      const contextual: ContextualCliError = new Error(
        typeof details.message === "string" ? details.message : "Vaultwarden CLI command failed",
      );
      if (typeof details.stderr === "string") contextual.stderr = details.stderr;
      contextual.recoverySource = sessionRecoverySource(session, sessionEnv, inherited);
      throw contextual;
    }
    return { stdout: result.stdout, stderr: result.stderr };
  };
}
