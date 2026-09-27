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

## SecretRef provider integration

The plugin also declares a managed OpenClaw exec SecretRef provider preset
named vaultwarden. OpenClaw runs the packaged Node resolver; the resolver
reads only exact Bitwarden item IDs and returns only the explicitly selected
field. It does not make secrets available through the plugin's read-only
tools.

Use a SecretRef ID in one of these forms:

- `<item-uuid>/password` — the login password only
- `<item-uuid>/field/<custom-field-name>` — exactly one custom text or hidden
  field with that exact name

For example, a supported service credential can refer to
`{ "source": "exec", "provider": "vaultwarden", "id":
"123e4567-e89b-42d3-a456-426614174000/password" }`. Replace the example UUID
with the selected item's UUID. Username, TOTP, notes, boolean fields, and
ambiguous/missing field names are not supported.

The resolver uses `BW_SESSION` when OpenClaw explicitly passes it. Otherwise it
reads `~/.openclaw/secrets/vaultwarden-session`, the private file created by
`openclaw vaultwarden`; set `VAULTWARDEN_SESSION_FILE` to override that path.
The file must be a regular, non-symlink file owned by the OpenClaw user with
no group/other permissions (normally mode 0600) and contain one non-empty
session value. Ensure bw is installed and configured for the intended
Vaultwarden profile on the OpenClaw host.

Requests are bounded, item IDs are strict UUIDs, and `bw get item <UUID>` is
spawned without a shell, with a timeout and output limit. Resolver failures
are generic and do not include CLI output or secret values. SecretRef
materialization is handled by OpenClaw for supported config fields; this does
not add a Git credential handoff.

OpenClaw classifies private/self-hosted Git installs as unverified provenance,
even when the installed commit matches the reviewed branch. This describes
the source channel, not a content scan. Keep `vaultwarden` in the existing
`plugins.allow` inventory when using an explicit plugin allowlist; do not
replace the inventory with only this plugin. The allowlist pins which plugin
IDs may load, but does not turn a private Git source into an official install.

## Session expiry and recovery

Vault access tools never attempt to unlock the vault or prompt for the master
password. If the Bitwarden CLI reports an expired or unavailable session, the
tool returns a generic recovery instruction instead of raw CLI output. On the
OpenClaw host, run `openclaw vaultwarden` in a trusted terminal. It logs in only
when the CLI is unauthenticated, prompts locally to unlock, and atomically
replaces the configured session file with mode `0600`. Retry the tool after the
command succeeds; the file SecretRef is read for each CLI operation, so no
session value needs to be copied into chat or config.

For a local operator setup that does not depend on Gateway environment
inheritance, run this from the OpenClaw host:

```bash
openclaw vaultwarden --session-file ~/.openclaw/secrets/vaultwarden-session
```

The command runs `bw unlock --raw` with the password prompt attached to the
terminal, stores only the resulting session in a `0600` file, and prints no
token. Configure the OpenClaw file provider and plugin reference using the
values it prints, then reload the plugin. The model still cannot unlock the
vault or receive the session token.

## Security model

- Interactive tools issue read-only CLI commands and expose metadata only.
- Metadata-first output with field-level redaction.
- Generic errors; CLI output and credentials are not copied into errors.
- Structured audit events contain only operation and success/error outcome.
- The separate SecretRef resolver retrieves only the explicitly selected
  password or custom text/hidden field for OpenClaw's supported secret
  resolution path; it does not expose values through plugin tools or logs.
- The plugin does not unlock the vault or mutate vault data.

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
profile on exit. This is a mixed-capability plugin (tools, auth CLI, and
SecretRef provider); OpenClaw's `plugins validate` authoring check is for
`defineToolPlugin`-style tool-only packages. Use the installed runtime smoke
test for this package instead of treating that tool-only check as a generic
plugin validity gate.
