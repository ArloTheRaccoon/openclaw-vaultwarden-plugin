# Release checklist

## Current baseline

- Read-only tools implemented and redaction tested.
- Opt-in login-item CRUD implemented, tested, and merged.
- Disposable authenticated Vaultwarden integration passes.
- Compiled standalone runtime installs into local OpenClaw.
- Local runtime exposes the read-only tools and opt-in CRUD tools when enabled.
- Production trial remains locked/unauthenticated from the Gateway process.
- npm and ClawHub currently publish `@arloraccoon/openclaw-vaultwarden-plugin@0.1.2`.
- GitHub OIDC Trusted Publishing is configured but still requires one successful tag publication to prove package authorization.

## Release validation

- `pnpm test`
- `pnpm test:package`
- `pnpm typecheck`
- `pnpm lint`
- `pnpm build`
- `bash tests/test-integration.sh` when Docker and disposable Vaultwarden are available.
- `clawhub package validate . --openclaw-version 2026.9.8`

## npm publication runbook

1. Update the version and changelog on Forgejo `main`.
2. Run the validation commands above and inspect `npm pack --dry-run --ignore-scripts`.
3. Create and push an annotated `vX.Y.Z` tag; `publish-npm.yml` is the only npm publisher.
4. Verify npm `latest`, tarball integrity, and provenance before publishing to ClawHub.
5. Publish the same version to ClawHub and run its validation command.
6. Install from both registries on a clean host and verify runtime tool discovery.
7. Never use a personal npm token in CI; use the configured GitHub OIDC trusted publisher.

## Current gates

- OIDC publication still needs a new version/tag; `0.1.2` is already published.
- Clean-host OpenClaw install/runtime verification requires the target host.
- Session recovery guidance and mutation hardening continue through CREW beads.
