import { runBitwardenGetItem } from "./secret-resolver-cli.js";
import { MAX_REQUEST_BYTES } from "./secret-resolver.js";
import { runResolverProtocol } from "./secret-resolver-protocol.js";

async function main(): Promise<void> {
  let rawInput = "";
  let inputBytes = 0;
  process.stdin.setEncoding("utf8");
  for await (const chunk of process.stdin) {
    const text = typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8");
    inputBytes += Buffer.byteLength(text, "utf8");
    if (inputBytes > MAX_REQUEST_BYTES) {
      process.stdout.write(JSON.stringify({
        protocolVersion: 1,
        values: {},
        errors: { "*": "Unable to resolve secret" },
      }));
      return;
    }
    rawInput += text;
  }

  const result = await runResolverProtocol(rawInput, {
    env: process.env,
    getItem: async (itemId, session) => runBitwardenGetItem(itemId, session),
  });
  process.stdout.write(result);
}

void main().catch(() => {
  process.stdout.write(JSON.stringify({
    protocolVersion: 1,
    values: {},
    errors: { "*": "Unable to resolve secret" },
  }));
  process.exitCode = 1;
});
