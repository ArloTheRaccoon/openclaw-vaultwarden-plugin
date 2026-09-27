# Vaultwarden plugin security review

Date: 2026-09-24
Scope: read-only MVP and disposable integration harness

## Findings

### No critical or high findings

- The plugin does not accept a master password or secret value as a tool
  argument.
- Tool output is metadata-first and excludes passwords, usernames, TOTP seeds,
  secure notes, and other sensitive item fields.
- CLI errors are replaced with a generic message before reaching the model.
- Audit events contain only operation and success/error outcome.
- The integration harness uses volatile storage, an isolated CLI appdata
  directory, generated TLS, a synthetic account/item fixture, readiness
  polling, and guaranteed container cleanup.
- The workspace Guard scan completed with zero warnings.

## Release blockers

1. The plugin must be moved to the standalone repository before publication.
2. The standalone package must replace the monorepo `workspace:*` SDK
   development dependency with the external package/build arrangement.
3. npm authentication and provenance configuration are not present on this
   host; no publication was attempted.
4. ClawHub authentication/publication remains pending.

## Authenticated disposable verification

The disposable integration now provisions a synthetic account through the
Vaultwarden web registration flow over a temporary localhost TLS proxy. It
configures an isolated Bitwarden CLI profile, logs in and unlocks the fixture
vault, creates a synthetic item, and invokes the actual plugin tools. The gate
asserts that status, search, exact retrieval, folders, and collections work
while the fixture password, note, and username remain absent from output.
Bitwarden CLI 2026.7.0 does not provide a `register` command, so the web flow
is intentionally used only inside the disposable test container.

## Decision

The metadata-read MVP was suitable for continued local development. The
authenticated disposable fixture is closed; standalone packaging, npm,
provenance, and ClawHub release blockers remain open.

## Opt-in CRUD follow-up — 2026-09-27

This implementation adds create/update/soft-delete for one login item at a
time, gated by `allowMutations: true` (default: false). Reads remain
metadata-only; secret retrieval continues through the exact-field SecretRef
resolver. Updates load the exact item internally and preserve fields that were
not supplied. Delete is reversible only and requires confirmation equal to the
item UUID. Mutations use the Bitwarden CLI with encoded JSON delivered through
stdin; item payloads are absent from command-line arguments, plugin audit
events, responses, and surfaced errors. OpenClaw host transcript/logging
policy remains a separate boundary. The disposable integration is expected to
cover the complete create/read/update/delete flow.

The disposable integration covered the complete create/read/update/soft-delete
flow. Review on 2026-09-27 found no critical or high-severity issues; build,
typecheck, lint, 46 unit tests, Guard scan, and the disposable integration all
passed. This approves the implementation for merge, not automatic enablement.
An operator who opts in grants the agent permission to change login items, and
confirmation is an application guard rather than a separate human approval
channel. Keep mutation tools disabled until the target-agent permission policy
is explicitly approved. Production vault data was not used or changed by
implementation or tests.
