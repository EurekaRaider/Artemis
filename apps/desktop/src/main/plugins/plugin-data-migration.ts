import { createHash, randomUUID } from "node:crypto";
import {
  cp,
  lstat,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import { SKILL_METADATA_FILE } from "./skill-metadata.js";

const moves = [
  ["codex-plugins", "plugins"],
  ["codex-plugin-marketplaces", "plugin-marketplaces"],
] as const;
const stores = [
  ["codex-plugins.json", "plugins.json"],
  ["codex-plugin-marketplaces.json", "plugin-marketplaces.json"],
] as const;
const backupName = "plugin-format-migration-backup";
interface Journal {
  version: 1;
  status: "preparing" | "prepared" | "complete" | "rolled-back";
  migratedPlugins: number;
  skills: string[];
}
async function exists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}
async function json(path: string): Promise<Record<string, any> | undefined> {
  if (!(await exists(path))) return undefined;
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink() || info.size > 5 * 1024 * 1024)
    throw new Error("Plugin migration JSON file is invalid.");
  const value = JSON.parse(await readFile(path, "utf8"));
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Plugin migration JSON must be an object.");
  return value;
}
async function atomicJson(path: string, value: unknown) {
  const temporary = `${path}.migration-tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, {
    mode: 0o600,
  });
  await rename(temporary, path);
}
function safeName(value: unknown, kind: string): asserts value is string {
  if (
    typeof value !== "string" ||
    !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/u.test(value)
  )
    throw new Error(`Plugin migration ${kind} name is invalid.`);
}
async function noLinks(root: string) {
  if (!(await exists(root))) return;
  let visited = 0;
  const visit = async (path: string): Promise<void> => {
    if (++visited > 100_000)
      throw new Error("Plugin migration contains too many files.");
    const info = await lstat(path);
    if (info.isSymbolicLink())
      throw new Error("Plugin migration cannot follow symbolic links.");
    if (info.isDirectory()) {
      for (const entry of await readdir(path)) await visit(join(path, entry));
    } else if (!info.isFile())
      throw new Error("Plugin migration contains a special file.");
  };
  await visit(root);
}

/** Runs before MCP/Skill discovery. Signed package bytes and credential vaults are never rewritten. */
export async function migratePluginUserData(
  userDataRoot: string,
  skillsRoot: string,
): Promise<{
  migratedPlugins: number;
  backupPath?: string;
}> {
  const root = resolve(userDataRoot);
  const backup = join(root, backupName);
  const journalPath = join(root, "plugin-format-migration.json");
  let journal = (await json(journalPath)) as Journal | undefined;
  if (journal) {
    if (
      journal.version !== 1 ||
      !["preparing", "prepared", "complete", "rolled-back"].includes(
        journal.status,
      ) ||
      !Number.isSafeInteger(journal.migratedPlugins) ||
      journal.migratedPlugins < 0 ||
      !Array.isArray(journal.skills)
    )
      throw new Error("Plugin migration journal is invalid.");
    journal.skills.forEach((name) => safeName(name, "Skill"));
    if (journal.status === "complete")
      return { migratedPlugins: 0, backupPath: backup };
    if (journal.status === "rolled-back") {
      await noLinks(backup);
      await rename(backup, `${backup}-rolled-back-${randomUUID()}`);
      await rm(journalPath);
      journal = undefined;
    }
    if (journal?.status === "preparing") {
      // No source data is moved until preparation completes. Discard only our incomplete backup.
      for (const [, native] of [...moves, ...stores])
        if (await exists(join(root, native)))
          throw new Error(
            "Plugin migration preparation conflicts with native data.",
          );
      await noLinks(backup);
      await rm(backup, { recursive: true, force: true });
      await rm(journalPath);
      journal = undefined;
    }
  }
  if (!journal) {
    const legacyPaths = [...moves, ...stores].map(([old]) => join(root, old));
    if (!(await Promise.all(legacyPaths.map(exists))).some(Boolean))
      return { migratedPlugins: 0 };
    for (const [old, native] of [...moves, ...stores]) {
      if (await exists(join(root, native)))
        throw new Error(
          `Plugin migration destination conflict: ${native}. Existing data was preserved.`,
        );
      await noLinks(join(root, old));
    }
    const plugins = await json(join(root, stores[0][0]));
    const marketplaces = await json(join(root, stores[1][0]));
    const mcp = await json(join(root, "mcp.json"));
    if (plugins && (plugins.version !== 1 || !Array.isArray(plugins.plugins)))
      throw new Error("Legacy plugin store is invalid.");
    if (
      marketplaces &&
      (marketplaces.version !== 1 || !Array.isArray(marketplaces.sources))
    )
      throw new Error("Legacy marketplace store is invalid.");
    if (
      mcp &&
      (![1, 2, 3].includes(mcp.version) || !Array.isArray(mcp.servers))
    )
      throw new Error("MCP migration store is invalid.");
    const ownedIds = new Set<string>();
    const skillNames = new Set<string>();
    const skillOwners = new Map<string, string>();
    for (const plugin of plugins?.plugins ?? []) {
      safeName(plugin.id, "plugin");
      if (!Array.isArray(plugin.skills) || !Array.isArray(plugin.mcpServers))
        throw new Error("Legacy plugin resource list is invalid.");
      for (const skill of plugin.skills) {
        safeName(skill.name, "Skill");
        if (skillOwners.has(skill.name))
          throw new Error("Legacy plugin Skill ownership is duplicated.");
        skillNames.add(skill.name);
        skillOwners.set(skill.name, `codex-plugin/${plugin.id}/${skill.name}`);
      }
      for (const server of plugin.mcpServers) {
        safeName(server.id, "MCP");
        ownedIds.add(server.id);
      }
      plugin.formatMigrationRequired = true;
      plugin.formatMigrationEnabledMcpIds = (mcp?.servers ?? [])
        .filter(
          (server: any) =>
            server.enabled === true &&
            plugin.mcpServers.some((owned: any) => owned.id === server.id),
        )
        .map((server: any) => server.id);
    }
    for (const name of skillNames) await noLinks(join(skillsRoot, name));
    for (const source of marketplaces?.sources ?? []) {
      if (typeof source.cachePath !== "string") continue;
      const oldRoot = join(root, moves[1][0]);
      const relation = relative(oldRoot, source.cachePath);
      if (
        relation === "" ||
        resolve(source.cachePath).startsWith(`${oldRoot}${sep}`)
      )
        source.cachePath = join(root, moves[1][1], relation);
    }
    for (const server of mcp?.servers ?? [])
      if (ownedIds.has(server.id)) server.enabled = false;
    if (await exists(backup))
      throw new Error(
        "Plugin migration backup already exists without a journal. Recover it before retrying.",
      );
    journal = {
      version: 1,
      status: "preparing",
      migratedPlugins: plugins?.plugins.length ?? 0,
      skills: [...skillNames],
    };
    await atomicJson(journalPath, journal);
    await mkdir(backup, { recursive: true, mode: 0o700 });
    for (const path of [...legacyPaths, join(root, "mcp.json")]) {
      if (await exists(path))
        await cp(path, join(backup, relative(root, path)), {
          recursive: true,
          errorOnExist: true,
          force: false,
        });
    }
    await mkdir(join(backup, "native"));
    if (plugins)
      await atomicJson(join(backup, "native", stores[0][1]), plugins);
    if (marketplaces)
      await atomicJson(join(backup, "native", stores[1][1]), marketplaces);
    if (mcp) await atomicJson(join(backup, "native", "mcp.json"), mcp);
    await mkdir(join(backup, "skills"));
    for (const name of skillNames) {
      const path = join(skillsRoot, name, SKILL_METADATA_FILE);
      const metadata = await json(path);
      if (
        !metadata ||
        typeof metadata.id !== "string" ||
        metadata.id !== skillOwners.get(name)
      )
        continue;
      await mkdir(join(backup, "skills", name));
      await cp(path, join(backup, "skills", name, SKILL_METADATA_FILE));
      metadata.id = metadata.id.replace(/^codex-plugin\//u, "artemis-plugin/");
      if (typeof metadata.source === "string")
        metadata.source = metadata.source.replace(
          /^codex-plugin:/u,
          "artemis-plugin:",
        );
      await atomicJson(join(backup, "skills", name, "native.json"), metadata);
    }
    journal = {
      version: 1,
      status: "prepared",
      migratedPlugins: plugins?.plugins.length ?? 0,
      skills: [...skillNames],
    };
    await atomicJson(journalPath, journal);
  }
  await noLinks(backup);
  // Every commit step is repeatable after a crash; all output was prepared before the first move.
  for (const [old, native] of moves) {
    if (await exists(join(root, old))) {
      if (await exists(join(root, native)))
        throw new Error(`Plugin migration destination conflict: ${native}.`);
      await rename(join(root, old), join(root, native));
    }
  }
  for (const name of [...stores.map(([, native]) => native), "mcp.json"]) {
    const value = await json(join(backup, "native", name));
    if (value) await atomicJson(join(root, name), value);
  }
  for (const name of journal.skills) {
    const value = await json(join(backup, "skills", name, "native.json"));
    if (value) {
      await noLinks(join(skillsRoot, name));
      await atomicJson(join(skillsRoot, name, SKILL_METADATA_FILE), value);
    }
  }
  await mkdir(join(backup, "retired"), { recursive: true });
  for (const [old] of stores)
    if (await exists(join(root, old)))
      await rename(join(root, old), join(backup, "retired", old));
  await atomicJson(journalPath, { ...journal, status: "complete" });
  return { migratedPlugins: journal.migratedPlugins, backupPath: backup };
}

async function treeDigest(root: string): Promise<string> {
  await noLinks(root);
  const hash = createHash("sha256");
  const visit = async (path: string): Promise<void> => {
    const info = await lstat(path);
    hash
      .update(relative(root, path))
      .update("\0")
      .update(info.isDirectory() ? "directory" : "file")
      .update("\0");
    if (info.isDirectory()) {
      for (const name of (await readdir(path)).sort())
        await visit(join(path, name));
    } else
      hash.update(
        createHash("sha256")
          .update(await readFile(path))
          .digest(),
      );
  };
  await visit(root);
  return hash.digest("hex");
}

/** Recovery is deliberately refused after any native user change, including package updates. */
export async function rollbackPluginUserData(
  userDataRoot: string,
  skillsRoot: string,
): Promise<void> {
  const root = resolve(userDataRoot);
  const backup = join(root, backupName);
  const journalPath = join(root, "plugin-format-migration.json");
  const journal = (await json(journalPath)) as Journal | undefined;
  if (
    !journal ||
    journal.version !== 1 ||
    journal.status !== "complete" ||
    !Array.isArray(journal.skills)
  )
    throw new Error("No completed plugin migration is available for rollback.");
  journal.skills.forEach((name) => safeName(name, "Skill"));
  await noLinks(backup);
  const matching = async (current: string, expected: string) => {
    if (
      !(await exists(current)) ||
      (await treeDigest(current)) !== (await treeDigest(expected))
    )
      throw new Error(
        "Native plugin data changed after migration; rollback refuses to overwrite it.",
      );
  };
  for (const [old, native] of moves) {
    if (await exists(join(root, old)))
      throw new Error(
        "Legacy plugin destination already exists; rollback refuses to overwrite it.",
      );
    if (await exists(join(backup, old)))
      await matching(join(root, native), join(backup, old));
  }
  for (const [old, native] of stores) {
    if (await exists(join(root, old)))
      throw new Error(
        "Legacy plugin destination already exists; rollback refuses to overwrite it.",
      );
    if (await exists(join(backup, old)))
      await matching(join(root, native), join(backup, "native", native));
  }
  if (await exists(join(backup, "native", "mcp.json")))
    await matching(join(root, "mcp.json"), join(backup, "native", "mcp.json"));
  for (const name of journal.skills) {
    const expected = join(backup, "skills", name, "native.json");
    if (await exists(expected))
      await matching(join(skillsRoot, name, SKILL_METADATA_FILE), expected);
  }
  for (const [old, native] of moves)
    if (await exists(join(backup, old)))
      await rename(join(root, native), join(root, old));
  const restoreFile = async (from: string, to: string) => {
    await writeFile(`${to}.restore-tmp`, await readFile(from), { mode: 0o600 });
    await rename(`${to}.restore-tmp`, to);
  };
  for (const [old, native] of stores)
    if (await exists(join(backup, old))) {
      await restoreFile(join(backup, old), join(root, old));
      await rm(join(root, native));
    }
  if (await exists(join(backup, "mcp.json")))
    await restoreFile(join(backup, "mcp.json"), join(root, "mcp.json"));
  for (const name of journal.skills) {
    const from = join(backup, "skills", name, SKILL_METADATA_FILE);
    if (await exists(from))
      await restoreFile(from, join(skillsRoot, name, SKILL_METADATA_FILE));
  }
  await atomicJson(journalPath, { ...journal, status: "rolled-back" });
}
