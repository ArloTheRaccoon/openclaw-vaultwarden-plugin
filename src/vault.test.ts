import { describe, expect, it } from "vitest";
import { parseItemList, redactVaultItem } from "./vault.js";

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
});
