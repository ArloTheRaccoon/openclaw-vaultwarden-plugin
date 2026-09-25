# OpenClaw Vaultwarden plugin

Read-only Bitwarden-compatible Vaultwarden tools for OpenClaw.

## Scope

The plugin exposes five metadata-safe tools:

- `vaultwarden_status`
- `vaultwarden_search`
- `vaultwarden_get_item`
- `vaultwarden_list_folders`
- `vaultwarden_list_collections`

Passwords, usernames, TOTP seeds, secure notes, and other sensitive item
fields are not returned. Write operations are intentionally out of scope.

## Prerequisites

Install the Bitwarden CLI (`bw`) and configure it for the target server before
starting OpenClaw:

```bash
bw config server https://vaultwarden.example.com
bw login
bw unlock
```

The plugin reads the existing CLI session through `BW_SESSION`; it never asks
the model for a master password. For isolated testing, set
`BITWARDENCLI_APPDATA_DIR` to a temporary directory and do not point it at a
production CLI profile.

## OpenClaw configuration

The plugin accepts:

- `adapter`: currently `cli`
- `sessionEnv`: alternate environment variable name for the CLI session
- `session`: an OpenClaw SecretRef or session string; SecretRef is recommended
- `timeoutSeconds`: command timeout, from 1 to 120 seconds
- `maxResults`: result bound, from 1 to 100 items

Example:

```json
{
  "adapter": "cli",
  "timeoutSeconds": 15,
  "maxResults": 20
}
```

For a managed deployment, keep the session out of plaintext config and chat by
using an OpenClaw SecretRef:

```json5
{
  plugins: {
    entries: {
      vaultwarden: {
        enabled: true,
        config: {
          session: {
            source: "env",
            provider: "default",
            id: "BW_SESSION"
          }
        }
      }
    }
  }
}
```

The session is resolved only at the CLI boundary and is never returned by a
tool or written to audit events. File and exec SecretRefs are also supported.
An operator-auth setup flow for minting and refreshing sessions remains a
separate release gate.

## Security model

- Read-only CLI commands only.
- Metadata-first output with field-level redaction.
- Generic errors; CLI output and credentials are not copied into errors.
- Structured audit events contain only operation and success/error outcome.
- No vault unlock, secret retrieval, or mutation is performed by the plugin.

## Local verification

From the OpenClaw checkout:

```bash
bash extensions/vaultwarden/test-integration.sh
pnpm exec vitest run --config test/vitest/vitest.extensions.config.ts \
  extensions/vaultwarden/index.test.ts \
  extensions/vaultwarden/src/cli.test.ts \
  extensions/vaultwarden/src/vault.test.ts \
  extensions/vaultwarden/src/audit.test.ts
pnpm exec oxlint --tsconfig config/tsconfig/oxlint.extensions.json extensions/vaultwarden
```

The integration script creates a disposable volatile Vaultwarden container,
waits for `/alive` and `/api/config`, provisions a synthetic account through
the disposable web registration flow, verifies isolated CLI login/unlock and
the read-only plugin tools, and removes the container and temporary CLI
profile on exit.
