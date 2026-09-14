import assert from "node:assert/strict";
import { test } from "node:test";
import { IdeRegistry } from "./ide-registry.js";

test("Factory chip appears only when the dispatch probe succeeds", async () => {
  const reachable = new IdeRegistry({ probeFactory: async () => true });
  const withFactory = await reachable.listAvailable();
  const factory = withFactory.find((ide) => ide.provider === "factory");
  assert.ok(factory);
  assert.equal(factory.connected, true);
  assert.equal(factory.source, "factory");
  assert.equal(reachable.isConnected("/tmp/app", "factory"), true);

  const offline = new IdeRegistry({ probeFactory: async () => false });
  const without = await offline.listAvailable();
  assert.equal(
    without.some((ide) => ide.provider === "factory"),
    false,
  );
  assert.equal(offline.isConnected("/tmp/app", "factory"), false);
});

test("Factory chip ignores a factory heartbeat from the extension", async () => {
  const registry = new IdeRegistry({ probeFactory: async () => false });
  registry.heartbeat({
    provider: "factory",
    source: "extension",
    workspacePath: "/tmp/app",
  });
  const ides = await registry.listAvailable("/tmp/app");
  assert.equal(
    ides.some((ide) => ide.provider === "factory"),
    false,
  );
});
