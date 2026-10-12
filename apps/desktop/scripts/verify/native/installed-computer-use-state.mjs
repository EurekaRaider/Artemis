import assert from "node:assert/strict";
import { join } from "node:path";

export function installedComputerUsePreviewPath(userData, version) {
  return join(
    userData,
    "capability-packs",
    "computer-use",
    version,
    "payload",
    "ArtemisComputerUse.app",
    "Contents",
    "Frameworks",
    "artemis-computer-preview.node",
  );
}

export function assertInstalledComputerUse({
  before,
  after,
  plugin,
  skills,
  mcpServers,
}) {
  assert.equal(before.activeVersion, undefined);
  assert.equal(before.supported, true);
  assert(before.availableVersion);
  assert.equal(after.activeVersion, before.availableVersion);
  assert.equal(plugin?.installed, true);
  assert.equal(plugin?.version, after.activeVersion);
  assert(plugin.skillNames.length > 0);
  assert(plugin.mcpServerIds.length > 0);
  assert.deepEqual(
    skills.map((skill) => skill.name).sort(),
    [...plugin.skillNames].sort(),
  );
  assert.deepEqual(
    mcpServers.map((server) => server.id).sort(),
    [...plugin.mcpServerIds].sort(),
  );
  for (const skill of skills) assert.equal(skill.enabled, true);
  for (const server of mcpServers) assert.equal(server.enabled, true);
}
