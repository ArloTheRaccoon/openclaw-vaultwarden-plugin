import assert from "node:assert/strict";
import { resolveSecretRequest } from "../src/secret-resolver.js";
import { createBitwardenCliRunner } from "../src/cli.js";
import { createVaultwardenStatusTool } from "../src/status-tool.js";
import {
  createVaultwardenCreateItemTool,
  createVaultwardenDeleteItemTool,
  createVaultwardenGetItemTool,
  createVaultwardenListCollectionsTool,
  createVaultwardenListFoldersTool,
  createVaultwardenSearchTool,
  createVaultwardenUpdateItemTool,
} from "../src/vault-tools.js";
import { searchVaultItems } from "../src/vault.js";

type ToolResult = {
  content?: Array<{ type?: string; text?: string }>;
  structuredContent?: unknown;
};

function dataOf(result: unknown): Record<string, unknown> {
  const toolResult = result as ToolResult;
  if (toolResult.structuredContent && typeof toolResult.structuredContent === "object") {
    return toolResult.structuredContent as Record<string, unknown>;
  }
  const text = toolResult.content?.find((content) => content.type === "text")?.text;
  if (!text) throw new Error("Tool response did not contain structured data");
  return JSON.parse(text) as Record<string, unknown>;
}

const runner = createBitwardenCliRunner({ env: process.env });
const fixturePassword = process.env.FIXTURE_PASSWORD;
const fixtureNote = process.env.FIXTURE_NOTE;
const fixtureItemId = process.env.FIXTURE_ITEM_ID;
if (!fixturePassword || !fixtureNote || !fixtureItemId || !process.env.BW_SESSION) {
  throw new Error("Disposable Vaultwarden smoke-test environment is incomplete");
}

const status = await createVaultwardenStatusTool(runner).execute();
const search = await createVaultwardenSearchTool(runner, 20).execute("test", {
  query: "OpenClaw Synthetic Fixture",
});
const fixture = await createVaultwardenGetItemTool(runner).execute("test", { itemId: fixtureItemId });
const folders = await createVaultwardenListFoldersTool(runner, 20).execute();
const collections = await createVaultwardenListCollectionsTool(runner, 20).execute();
const readOutput = JSON.stringify({ status, search, fixture, folders, collections });
assert.match(readOutput, /unlocked/);
assert.match(readOutput, /OpenClaw Synthetic Fixture/);
assert.doesNotMatch(readOutput, new RegExp(fixturePassword));
assert.doesNotMatch(readOutput, new RegExp(fixtureNote));
assert.doesNotMatch(readOutput, /fixture-user@example\.test/);

const createSecret = `CRUD-CREATE-${Date.now()}`;
const updateSecret = `CRUD-UPDATE-${Date.now()}`;
const initialFieldValue = `CRUD-FIELD-CREATE-${Date.now()}`;
const updatedFieldValue = `CRUD-FIELD-UPDATE-${Date.now()}`;
const initialNote = `CRUD-NOTE-CREATE-${Date.now()}`;
const audits: unknown[] = [];
const createdResult = await createVaultwardenCreateItemTool(runner, (event) => audits.push(event)).execute("test", {
  name: "OpenClaw CRUD Synthetic Fixture",
  username: "crud-user@example.test",
  password: createSecret,
  uris: ["https://crud-fixture.example.test"],
  notes: initialNote,
  fields: [{ name: "hook-token", value: initialFieldValue, type: "hidden" }],
});
const created = dataOf(createdResult);
const createdItemId = created.id;
assert.match(String(createdItemId), /^[0-9a-f-]{36}$/i);
assert.equal(created.name, "OpenClaw CRUD Synthetic Fixture");

const itemReader = createVaultwardenGetItemTool(runner);
const createdRead = await itemReader.execute("test", { itemId: String(createdItemId) });
let output = JSON.stringify({ createdResult, createdRead });
for (const secret of [createSecret, initialFieldValue, initialNote, "crud-user@example.test"]) {
  assert.doesNotMatch(output, new RegExp(secret));
}

const updatedResult = await createVaultwardenUpdateItemTool(runner, (event) => audits.push(event)).execute("test", {
  itemId: String(createdItemId),
  password: updateSecret,
  notes: null,
  fields: [{ name: "hook-token", value: updatedFieldValue, type: "hidden" }],
});
const updated = dataOf(updatedResult);
assert.equal(updated.id, createdItemId);
assert.equal(updated.name, "OpenClaw CRUD Synthetic Fixture");
output = JSON.stringify(updatedResult);
for (const secret of [createSecret, updateSecret, initialFieldValue, updatedFieldValue, initialNote]) {
  assert.doesNotMatch(output, new RegExp(secret));
}

const secretResponse = await resolveSecretRequest(
  JSON.stringify({ protocolVersion: 1, ids: [`${createdItemId}/password`, `${createdItemId}/field/hook-token`] }),
  {
    env: { BW_SESSION: process.env.BW_SESSION },
    getItem: async (itemId) => JSON.parse((await runner(["get", "item", itemId])).stdout) as never,
  },
);
assert.deepEqual(secretResponse.values, {
  [`${createdItemId}/password`]: updateSecret,
  [`${createdItemId}/field/hook-token`]: updatedFieldValue,
});
assert.deepEqual(secretResponse.errors, {});

const deleteResult = await createVaultwardenDeleteItemTool(runner, (event) => audits.push(event)).execute("test", {
  itemId: String(createdItemId),
  confirmation: String(createdItemId),
});
assert.deepEqual(dataOf(deleteResult), { id: createdItemId, deleted: true });
const remainingItems = await searchVaultItems({
  runner,
  query: "OpenClaw CRUD Synthetic Fixture",
  maxResults: 10,
});
assert.equal(remainingItems.some((item) => item.id === createdItemId), false);

output = JSON.stringify({ createdResult, createdRead, updatedResult, deleteResult, audits });
for (const secret of [createSecret, updateSecret, initialFieldValue, updatedFieldValue, initialNote]) {
  assert.doesNotMatch(output, new RegExp(secret));
}
assert.deepEqual(audits, [
  { event: "vaultwarden.tool", operation: "create_item", outcome: "success" },
  { event: "vaultwarden.tool", operation: "update_item", outcome: "success" },
  { event: "vaultwarden.tool", operation: "delete_item", outcome: "success" },
]);
