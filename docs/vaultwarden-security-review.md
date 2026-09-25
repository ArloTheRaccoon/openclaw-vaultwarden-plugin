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

The read-only MVP is suitable for continued local development. The
authenticated disposable fixture is closed; standalone packaging, npm,
provenance, and ClawHub release blockers remain open.
