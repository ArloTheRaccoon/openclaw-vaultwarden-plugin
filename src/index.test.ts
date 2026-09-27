import { describe, expect, it } from "vitest";
import plugin from "../index.js";

function registeredTools(allowMutations: unknown) {
  const names: string[] = [];
  const config = {
    plugins: { entries: { vaultwarden: { config: { allowMutations } } } },
  };
  plugin.register({
    pluginConfig: { allowMutations },
    config,
    logger: { info: () => undefined },
    registerTool: (tool: { name: string }, options?: { name?: string }) =>
      names.push(options?.name ?? tool.name),
  } as never);
  return names;
}

describe("Vaultwarden plugin registration", () => {
  it("keeps mutating tools absent unless config is exactly true", () => {
    expect(registeredTools(undefined)).toEqual([
      "vaultwarden_status",
      "vaultwarden_search",
      "vaultwarden_get_item",
      "vaultwarden_list_folders",
      "vaultwarden_list_collections",
    ]);
    expect(registeredTools("true")).not.toContain("vaultwarden_create_item");
  });

  it("registers the three login-item mutation tools when explicitly enabled", () => {
    expect(registeredTools(true)).toEqual([
      "vaultwarden_status",
      "vaultwarden_search",
      "vaultwarden_get_item",
      "vaultwarden_list_folders",
      "vaultwarden_list_collections",
      "vaultwarden_create_item",
      "vaultwarden_update_item",
      "vaultwarden_delete_item",
    ]);
  });
});
