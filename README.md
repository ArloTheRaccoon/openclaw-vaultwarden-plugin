# OpenClaw Vaultwarden plugin

Metadata-safe Bitwarden-compatible Vaultwarden tools for OpenClaw, with
explicitly opt-in login-item mutations.

## Scope

The plugin always exposes these metadata-safe tools:

- `vaultwarden_status`
- `vaultwarden_search`
- `vaultwarden_get_item`
- `vaultwarden_list_folders`
- `vaultwarden_list_collections`

When `allowMutations: true` is explicitly configured, it additionally exposes:

- `vaultwarden_create_item`
- `vaultwarden_update_item`
- `vaultwarden_delete_item`

Item reads remain metadata-only. Passwords, usernames, TOTP seeds, notes, and
custom-field values are not returned by these tools. The separate SecretRef
resolver remains the supported exact-field path for supplying a password or
hidden/text custom field to OpenClaw.

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
- `allowMutations`: explicitly register create/update/soft-delete tools; defaults to `false`

Example:

```json
{
  "adapter": "cli",
  "timeoutSeconds": 15,
  "maxResults": 20
}
```

The read-only default is preserved unless the operator opts in:

```json5
{
  plugins: {
    entries: {
      vaultwarden: {
        enabled: true,
        config: {
          allowMutations: true
        }
      }
    }
  }
}
```

## Controlled login-item mutations

The optional mutation tools operate on one Bitwarden **login** item at a time.
Create accepts a name plus optional username, password, URIs, notes, folder,
collections, and custom fields (hidden by default). Update fetches the exact
item internally, changes only supplied fields, and preserves other existing
item data; it rejects non-login items. Set a field to `null` or an array to
`[]` to clear/replace it where supported. Update/delete require a strict item
UUID. Delete is a reversible Bitwarden soft-delete only; it requires a
`confirmation` argument exactly matching `itemId`. Permanent deletion and bulk
operations are not exposed.

Mutation payloads are encoded and sent to the local `bw` process over stdin,
not placed in command-line arguments. They are excluded from this plugin's
audit events and tool results; CLI output and errors are redacted before they
reach the caller. OpenClaw's own tool-call transcript/logging policy is a
separate boundary. Enable mutations only for agents/workflows authorized to
change the vault. Install and tests do not change production vault data.

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
tool returns a recovery instruction tailored to the configured session source
instead of raw CLI output. For a local file SecretRef, refresh that same file
with `openclaw vaultwarden --session-file <path>` (only for a single-value file
provider); the default command path is not necessarily the path your SecretRef
uses. For an environment, exec, or store SecretRef, update the value at its
provider and retry—the command writes a local file and does not update those
providers. For an unconfigured session, the command creates the default local
session file, which must then be configured as a file SecretRef. The helper logs
in only when the CLI is unauthenticated, prompts locally to unlock, and writes
the token atomically with mode `0600`. Never copy a session value into chat.

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

- Interactive reads expose metadata only; optional writes are disabled by default.
- Writes are single-item login operations, exact-ID scoped, and never hard-delete.
- Secret payloads travel to the CLI over stdin; this plugin excludes them from audit events and tool results. Host transcript/logging policy is separate.
- Metadata-first output with field-level redaction.
- Generic errors; CLI output and credentials are not copied into errors.
- Structured audit events contain only operation and success/error outcome.
- The separate SecretRef resolver retrieves only the explicitly selected
  password or custom text/hidden field for OpenClaw's supported secret
  resolution path; it does not expose values through plugin tools or logs.
- The plugin does not unlock the vault. Vault mutation tools are registered only
  when `allowMutations` is exactly `true`.

## Local verification

From this standalone repository:

```bash
pnpm test
pnpm typecheck
pnpm lint
pnpm build
bash tests/test-integration.sh
```

The disposable integration gate also requires Docker, `bw`, `curl`, OpenSSL,
and Playwright Chromium. Install Chromium once with
`pnpm exec playwright install chromium`.

The integration script creates a disposable volatile Vaultwarden container,
waits for `/alive` and `/api/config`, provisions a synthetic account through
the disposable web registration flow, verifies isolated CLI login/unlock,
metadata reads, opt-in create/update/soft-delete, and SecretRef retrieval, then
removes the container and temporary CLI profile on exit. This is a
mixed-capability plugin (tools, auth CLI, and
SecretRef provider); OpenClaw's `plugins validate` authoring check is for
`defineToolPlugin`-style tool-only packages. Use the installed runtime smoke
test for this package instead of treating that tool-only check as a generic
plugin validity gate.
