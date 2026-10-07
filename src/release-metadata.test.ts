import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("release metadata", () => {
  it("uses npm-normalized repository metadata", async () => {
    const packageJson = JSON.parse(
      await readFile(resolve(import.meta.dirname, "../package.json"), "utf8"),
    ) as { repository?: { type?: string; url?: string }; packageManager?: string };

    expect(packageJson.repository).toEqual({
      type: "git",
      url: "git+https://github.com/ArloTheRaccoon/openclaw-vaultwarden-plugin.git",
    });
    expect(packageJson.packageManager).toBe("pnpm@10.33.2");
  });
});
