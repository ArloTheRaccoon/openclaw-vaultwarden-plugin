# Release checklist

## Completed locally

- Read-only tools implemented and redaction tested.
- Disposable authenticated Vaultwarden integration passes.
- Compiled standalone runtime installs into local OpenClaw.
- Local runtime exposes all five tools.
- Production trial remains locked/unauthenticated from the Gateway process.

## Deferred by decision

- Seamless OpenClaw auth/session setup for `BW_SESSION`.
- Session expiry and re-authentication flow.

## Required before publication

- Create and review the standalone GitHub repository.
- Replace the local version with a public semver release.
- Confirm the final OpenClaw SDK/runtime compatibility contract.
- Configure npm authentication and provenance.
- Publish and verify the npm package.
- Publish and verify the ClawHub package.
- Run a clean-host install and read-only smoke test.
- Complete release/security sign-off.
