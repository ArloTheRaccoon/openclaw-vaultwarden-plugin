import { mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { storeSessionToken } from "./auth-cli.js";

describe("Vaultwarden auth setup", () => {
  it("stores the session in a private file without changing its value", () => {
    const dir = mkdtempSync(join(tmpdir(), "vaultwarden-auth-"));
    const target = storeSessionToken("  synthetic-session  ", join(dir, "session"));

    expect(readFileSync(target, "utf8")).toBe("synthetic-session\n");
    expect(statSync(target).mode & 0o777).toBe(0o600);
  });
});
