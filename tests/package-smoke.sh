#!/usr/bin/env bash

set -euo pipefail

repo_root="$(cd "$(dirname "$0")/.." && pwd)"
work_dir="$(mktemp -d "${TMPDIR:-/tmp}/openclaw-vaultwarden-package.XXXXXX")"
trap 'rm -rf "$work_dir"' EXIT

cd "$repo_root"
pnpm run build >/dev/null
package_file="$(npm pack --ignore-scripts --pack-destination "$work_dir" | tail -n 1)"

tar -tzf "$work_dir/$package_file" | sed 's#^[^/]*/##' | sort >"$work_dir/files.txt"
diff -u <(printf '%s\n' README.md dist/index.mjs dist/secret-resolver.mjs openclaw.plugin.json package.json | sort) "$work_dir/files.txt"

mkdir "$work_dir/install"
cd "$work_dir/install"
npm init --yes >/dev/null
npm install --ignore-scripts --no-audit --no-fund "$work_dir/$package_file" >/dev/null

node --input-type=module <<'NODE'
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const packageJson = JSON.parse(await readFile(resolve("node_modules/@arloraccoon/openclaw-vaultwarden-plugin/package.json"), "utf8"));
const manifest = JSON.parse(await readFile(resolve("node_modules/@arloraccoon/openclaw-vaultwarden-plugin/openclaw.plugin.json"), "utf8"));
if (packageJson.name !== "@arloraccoon/openclaw-vaultwarden-plugin") throw new Error("unexpected package name");
if (packageJson.main !== "./dist/index.mjs") throw new Error("unexpected package entrypoint");
if (!manifest.contracts.tools.includes("vaultwarden_status")) throw new Error("status tool missing");
if (!manifest.contracts.tools.includes("vaultwarden_create_item")) throw new Error("CRUD tool missing");
if (!manifest.secretProviderIntegrations?.vaultwarden) throw new Error("secret provider missing");
console.log(`package smoke passed: ${packageJson.name}@${packageJson.version}`);
NODE
