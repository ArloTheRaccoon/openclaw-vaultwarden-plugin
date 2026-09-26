import {
  resolveSecretRequest,
  type SecretResolverOptions,
} from "./secret-resolver.js";

export async function runResolverProtocol(
  rawInput: string,
  options: SecretResolverOptions = {},
): Promise<string> {
  return JSON.stringify(await resolveSecretRequest(rawInput, options));
}
