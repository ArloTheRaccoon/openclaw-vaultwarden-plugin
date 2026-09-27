import { execFile } from "node:child_process";
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
export type CliRunner = (args: string[]) => Promise<CliResult>;
type CliExecutor = (
  file: string,
  args: string[],
  options: {
    env: NodeJS.ProcessEnv;
    timeout: number;
    maxBuffer: number;
  },
) => Promise<CliResult>;

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
  switch (source) {
    case "file":
      return "Refresh the file configured for the Vaultwarden SecretRef, then retry. For a single-value file provider, run `openclaw vaultwarden --session-file <configured-path>` in a trusted terminal; do not use that command on a JSON provider file.";
    case "env":
      return "Refresh the configured environment SecretRef in the Gateway's environment, then retry. `openclaw vaultwarden` writes a local file and does not replace an environment SecretRef.";
    case "exec":
    case "store":
      return "Refresh the configured SecretRef at its provider, then retry. `openclaw vaultwarden` writes a local file and does not update that provider.";
    case "inline":
      return "Replace the configured session value with a freshly unlocked session using a secure local configuration path; do not paste it into chat. `openclaw vaultwarden` writes a local file but does not change inline configuration.";
    default:
      return "On the OpenClaw host, run `openclaw vaultwarden` in a trusted terminal to create the default local session file, then configure the plugin session as a file SecretRef to that file and retry. The CLI does not read the file automatically.";
  }
}

type ContextualCliError = Error & { stderr?: string; recoverySource?: RecoverySource };

const sessionFailurePattern =
  /(?:session|token|authentication|credential).{0,48}(?:expired|invalid|unauthori[sz]ed|rejected|not valid)|(?:expired|invalid|unauthori[sz]ed|rejected).{0,48}(?:session|token|credential)|not logged in|you are not logged in|vault is locked|vault must be unlocked|\b401\b/i;

export function redactCliError(error: unknown): string {
  if (sessionFailurePattern.test(cliErrorText(error))) {
    const source =
      error && typeof error === "object" && "recoverySource" in error
        ? (error as ContextualCliError).recoverySource
        : undefined;
    return `Vaultwarden session is unavailable or expired. ${recoveryInstruction(source ?? "default")} The plugin will not prompt for or expose the master password.`;
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

  return async (args) => {
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
      result = await executor("bw", args, {
        env: commandEnv,
        timeout,
        maxBuffer: 2 * 1024 * 1024,
      });
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
