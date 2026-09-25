#!/usr/bin/env bash

set -euo pipefail

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker is required for the Vaultwarden integration gate." >&2
  exit 1
fi

if ! command -v curl >/dev/null 2>&1; then
  echo "curl is required for the Vaultwarden integration gate." >&2
  exit 1
fi

if ! command -v bw >/dev/null 2>&1; then
  echo "Bitwarden CLI (bw) is required for the Vaultwarden integration gate." >&2
  exit 1
fi

for command in node openssl; do
  if ! command -v "$command" >/dev/null 2>&1; then
    echo "${command} is required for the Vaultwarden integration gate." >&2
    exit 1
  fi
done

container="openclaw-vaultwarden-integration-${RANDOM}-${RANDOM}"
appdata="$(mktemp -d "${TMPDIR:-/tmp}/openclaw-vaultwarden-bw.XXXXXX")"
tls_dir=""
registration_pid=""
cleanup() {
  if [[ -n "$registration_pid" ]]; then
    kill "$registration_pid" >/dev/null 2>&1 || true
    wait "$registration_pid" >/dev/null 2>&1 || true
  fi
  docker rm -f "$container" >/dev/null 2>&1 || true
  rm -rf "$appdata"
  if [[ -n "$tls_dir" ]]; then
    rm -rf "$tls_dir"
  fi
}
trap cleanup EXIT INT TERM

# Vaultwarden refuses to boot without /data unless this explicit disposable-test
# opt-in is present. No host volume is mounted, so this container cannot touch
# production data and is always removed by the EXIT trap.
docker run --detach \
  --name "$container" \
  --publish 127.0.0.1::80 \
  --env SIGNUPS_ALLOWED=true \
  --env WEBSOCKET_ENABLED=false \
  --env I_REALLY_WANT_VOLATILE_STORAGE=true \
  vaultwarden/server:latest >/dev/null

port=""
for _ in $(seq 1 30); do
  port="$(docker port "$container" 80/tcp 2>/dev/null | sed -E 's/.*:([0-9]+)$/\1/' | head -n 1)"
  if [[ -n "$port" ]] && curl --fail --silent --show-error --max-time 2 "http://127.0.0.1:${port}/alive" >/dev/null; then
    break
  fi
  sleep 1
done

if [[ -z "$port" ]]; then
  echo "Vaultwarden did not publish a host port." >&2
  docker logs "$container" >&2 || true
  exit 1
fi

if ! curl --fail --silent --show-error --max-time 2 "http://127.0.0.1:${port}/alive" >/dev/null; then
  echo "Vaultwarden did not become ready on /alive." >&2
  docker logs "$container" >&2 || true
  exit 1
fi

if ! curl --fail --silent --show-error --max-time 2 "http://127.0.0.1:${port}/api/config" >/dev/null; then
  echo "Vaultwarden /api/config is not reachable." >&2
  docker logs "$container" >&2 || true
  exit 1
fi

BITWARDENCLI_APPDATA_DIR="$appdata" bw config server "http://127.0.0.1:${port}" >/dev/null 2>&1
status_json="$(BITWARDENCLI_APPDATA_DIR="$appdata" bw status --raw)"
if ! grep -Fq '"status":"unauthenticated"' <<<"$status_json"; then
  echo "Bitwarden CLI did not report the expected unauthenticated disposable state." >&2
  exit 1
fi

email="openclaw-vaultwarden-${RANDOM}-${RANDOM}@example.com"
password="OpenClawTest-${RANDOM}-${RANDOM}-Aa1!"
fixture_password="SYNTHETIC-PASSWORD-${RANDOM}-${RANDOM}"
fixture_note="SYNTHETIC-NOTE-${RANDOM}-${RANDOM}"
tls_dir="$(mktemp -d "${TMPDIR:-/tmp}/openclaw-vaultwarden-tls.XXXXXX")"
openssl req -x509 -newkey rsa:2048 -nodes \
  -keyout "$tls_dir/key.pem" -out "$tls_dir/cert.pem" \
  -days 1 -subj /CN=localhost >/dev/null 2>&1

VAULTWARDEN_BACKEND_URL="http://127.0.0.1:${port}" \
VAULTWARDEN_TLS_KEY="$tls_dir/key.pem" \
VAULTWARDEN_TLS_CERT="$tls_dir/cert.pem" \
VAULTWARDEN_PROXY_PORT_FILE="$tls_dir/proxy-port" \
VAULTWARDEN_REGISTRATION_DONE_FILE="$tls_dir/registration-done" \
VAULTWARDEN_KEEP_PROXY=1 \
VAULTWARDEN_TEST_EMAIL="$email" \
VAULTWARDEN_TEST_PASSWORD="$password" \
  node "$(dirname "$0")/test-fixture-registration.mjs" &
registration_pid="$!"

for _ in $(seq 1 30); do
  [[ -s "$tls_dir/proxy-port" ]] && [[ -s "$tls_dir/registration-done" ]] && break
  if ! kill -0 "$registration_pid" >/dev/null 2>&1; then
    wait "$registration_pid"
    exit 1
  fi
  sleep 1
done

if [[ ! -s "$tls_dir/proxy-port" ]] || [[ ! -s "$tls_dir/registration-done" ]]; then
  echo "Disposable Vaultwarden registration did not complete." >&2
  exit 1
fi
proxy_port="$(<"$tls_dir/proxy-port")"
export NODE_EXTRA_CA_CERTS="$tls_dir/cert.pem"

BITWARDENCLI_APPDATA_DIR="$appdata" bw config server "https://localhost:${proxy_port}" >/dev/null 2>&1
export BW_TEST_PASSWORD="$password"
export BW_SESSION="$(BITWARDENCLI_APPDATA_DIR="$appdata" bw --nointeraction login "$email" --passwordenv BW_TEST_PASSWORD --raw)"
export BW_SESSION="$(BITWARDENCLI_APPDATA_DIR="$appdata" bw --nointeraction unlock --passwordenv BW_TEST_PASSWORD --raw)"

fixture_json="$(printf '%s' "{\"type\":1,\"name\":\"OpenClaw Synthetic Fixture\",\"notes\":\"${fixture_note}\",\"login\":{\"username\":\"fixture-user@example.test\",\"password\":\"${fixture_password}\",\"uris\":[{\"uri\":\"https://fixture.example.test\"}]}}" | BITWARDENCLI_APPDATA_DIR="$appdata" bw encode)"
item_json="$(BITWARDENCLI_APPDATA_DIR="$appdata" bw create item "$fixture_json")"
item_id="$(node --input-type=module -e 'const value=JSON.parse(process.argv[1]); process.stdout.write(value.id)' "$item_json")"

BITWARDENCLI_APPDATA_DIR="$appdata" \
BW_SESSION="$BW_SESSION" \
FIXTURE_PASSWORD="$fixture_password" \
FIXTURE_NOTE="$fixture_note" \
FIXTURE_ITEM_ID="$item_id" \
  node --import tsx --input-type=module <<'NODE'
import assert from "node:assert/strict";
import { createBitwardenCliRunner } from "./extensions/vaultwarden/src/cli.ts";
import { createVaultwardenStatusTool } from "./extensions/vaultwarden/src/status-tool.ts";
import {
  createVaultwardenGetItemTool,
  createVaultwardenListCollectionsTool,
  createVaultwardenListFoldersTool,
  createVaultwardenSearchTool,
} from "./extensions/vaultwarden/src/vault-tools.ts";

const runner = createBitwardenCliRunner({ env: process.env });
const status = await createVaultwardenStatusTool(runner).execute();
const search = await createVaultwardenSearchTool(runner, 20).execute("test", {
  query: "OpenClaw Synthetic Fixture",
});
const item = await createVaultwardenGetItemTool(runner).execute("test", {
  itemId: process.env.FIXTURE_ITEM_ID,
});
const folders = await createVaultwardenListFoldersTool(runner, 20).execute();
const collections = await createVaultwardenListCollectionsTool(runner, 20).execute();
const output = JSON.stringify({ status, search, item, folders, collections });
assert.match(output, /unlocked/);
assert.match(output, /OpenClaw Synthetic Fixture/);
assert.doesNotMatch(output, new RegExp(process.env.FIXTURE_PASSWORD));
assert.doesNotMatch(output, new RegExp(process.env.FIXTURE_NOTE));
assert.doesNotMatch(output, /fixture-user@example\.test/);
NODE

echo "Vaultwarden disposable integration passed (container=${container}, port=${port})."
