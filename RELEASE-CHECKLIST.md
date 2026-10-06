# Release checklist

## Completed locally

- Read-only tools implemented and redaction tested.
- Opt-in login-item CRUD implemented, tested, and merged.
- Disposable authenticated Vaultwarden integration passes.
- Compiled standalone runtime installs into local OpenClaw.
- Local runtime exposes the read-only tools and opt-in CRUD tools when enabled.
- Production trial remains locked/unauthenticated from the Gateway process.

## Deferred by decision

- Seamless OpenClaw auth/session setup for `BW_SESSION`.
- Session expiry and re-authentication flow.

## Required before publication

- Review the standalone Forgejo repository and decide whether a public mirror is required.
- Replace the local version with a public semver release.
- Confirm the final OpenClaw SDK/runtime compatibility contract.
- Configure npm authentication and provenance.
- Publish and verify the npm package.
- Publish and verify the ClawHub package.
- Run a clean-host install and read-only smoke test.
- Complete release/security sign-off.

## Publication blockers observed 2026-10-05

- npm authentication is not configured on the release host (`npm whoami` returns `ENEEDAUTH`).
- The package is not yet present in the npm registry.
- No release tag exists yet.
- ClawHub CLI is installed, but publisher authentication has not been verified.
