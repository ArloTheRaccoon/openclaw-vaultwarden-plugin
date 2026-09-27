import { describe, expect, it } from "vitest";
import {
  buildLoginVaultItem,
  encodeVaultItem,
  mergeLoginVaultItem,
  parseItemList,
  redactVaultItem,
} from "./vault.js";

describe("Vaultwarden item redaction", () => {
  it("keeps metadata and strips sensitive login fields", () => {
    expect(
      redactVaultItem({
        id: "item-1",
        name: "Example",
        type: 1,
        folderId: null,
        collectionIds: ["collection-1"],
        login: {
          username: "user@example.test",
          password: "do-not-return",
          totp: "do-not-return",
          uris: [{ uri: "https://example.test" }],
        },
        notes: "do-not-return",
      }),
    ).toEqual({
      id: "item-1",
      name: "Example",
      type: 1,
      folderId: null,
      collectionIds: ["collection-1"],
      login: { uris: ["https://example.test"] },
    });
  });

  it("parses and bounds item lists", () => {
    const items = parseItemList(
      JSON.stringify([
        { id: "1", name: "One" },
        { id: "2", name: "Two" },
      ]),
      1,
    );
    expect(items).toEqual([{ id: "1", name: "One" }]);
  });

  it("builds a login item with hidden custom fields and encodes it for bw stdin", () => {
    const item = buildLoginVaultItem({
      name: "API service",
      username: "service-user",
      password: "dummy-password-value",
      uris: ["https://service.example.test"],
      fields: [{ name: "api-token", value: "dummy-custom-token", type: "hidden" }],
    });

    expect(item).toEqual({
      type: 1,
      name: "API service",
      login: {
        username: "service-user",
        password: "dummy-password-value",
        uris: [{ uri: "https://service.example.test" }],
      },
      fields: [{ name: "api-token", value: "dummy-custom-token", type: 1 }],
    });
    expect(JSON.parse(Buffer.from(encodeVaultItem(item), "base64").toString("utf8"))).toEqual(item);
  });

  it("updates only supplied login fields while preserving unrelated vault metadata", () => {
    const original = {
      id: "9a7e20c6-4aed-4e81-88af-048f7d99b013",
      type: 1,
      name: "API service",
      folderId: "d8440957-b204-4cf9-b944-0844669e8329",
      collectionIds: ["c4b9fcca-812b-4be1-96a1-59e35b009e0f"],
      notes: "keep this note",
      login: { username: "old-user", password: "old-password", uris: [{ uri: "https://old.example.test" }] },
    };

    expect(mergeLoginVaultItem(original, { password: "new-password", folderId: null })).toEqual({
      ...original,
      folderId: null,
      login: { ...original.login, password: "new-password" },
    });
    expect(mergeLoginVaultItem(original, { password: null, notes: null }).login?.password).toBeNull();
    expect(mergeLoginVaultItem(original, { password: null, notes: null }).notes).toBeNull();
    expect(() => mergeLoginVaultItem(original, {})).toThrow("No item fields were supplied");
  });

  it("rejects non-login items and malformed IDs before attempting an update", () => {
    expect(() => buildLoginVaultItem({ name: "   " })).toThrow();
    expect(() =>
      mergeLoginVaultItem({ id: "not-a-uuid", type: 1, name: "Example", login: {} }, { name: "Updated" }),
    ).toThrow();
    expect(() =>
      mergeLoginVaultItem({ id: "9a7e20c6-4aed-4e81-88af-048f7d99b013", type: 2, name: "Note" }, { name: "Updated" }),
    ).toThrow();
  });
});
