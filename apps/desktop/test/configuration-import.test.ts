import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { ConfigurationImportService } from "../src/main/configuration-import.js";
import { GlobalInstructionsStore } from "../src/main/global-instructions-store.js";

const cleanupPaths: string[] = [];

afterEach(async () => {
  for (const path of cleanupPaths.splice(0)) {
    await rm(path, { recursive: true, force: true });
  }
});

async function write(path: string, content: string) {
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, content, "utf8");
}

async function addSkill(root: string, name: string) {
  const directory = join(root, name);
  await mkdir(directory, { recursive: true });
  await writeFile(
    join(directory, "SKILL.md"),
    `---\nname: ${name}\ndescription: imported\n---\n`,
    "utf8",
  );
}

async function createService() {
  const root = await mkdtemp(join(tmpdir(), "artemis-import-"));
  cleanupPaths.push(root);
  const homePath = join(root, "home");
  const userDataPath = join(root, "user-data");
  const skillsPath = join(root, "pi-skills");
  const mcpWorkspaceRoot = join(userDataPath, "mcp-workspaces");
  await mkdir(homePath, { recursive: true });
  return {
    homePath,
    skillsPath,
    mcpWorkspaceRoot,
    globalPath: join(userDataPath, "AGENTS.md"),
    service: new ConfigurationImportService({
      homePath,
      skillsPath,
      mcpWorkspaceRoot,
      globalInstructions: new GlobalInstructionsStore(
        join(userDataPath, "AGENTS.md"),
      ),
    }),
  };
}

describe("ConfigurationImportService", () => {
  it("uses a private workspace and enables network by default for imported stdio servers", async () => {
    const { homePath, mcpWorkspaceRoot, service } = await createService();
    await write(
      join(homePath, ".codex", "config.toml"),
      [
        "[mcp_servers.context7]",
        'command = "npx"',
        'args = ["-y", "@upstash/context7-mcp@latest"]',
        "",
        "[mcp_servers.semi-mcp]",
        'command = "semi-mcp"',
        'args = ["serve"]',
      ].join("\n"),
    );
    await write(
      join(homePath, ".claude.json"),
      JSON.stringify({
        mcpServers: {
          localFiles: {
            type: "stdio",
            command: "node",
            args: ["files.mjs"],
          },
        },
      }),
    );

    const imported = await service.import({
      sources: ["codex", "claude"],
      categories: ["mcp"],
    });
    const byId = new Map(
      imported.mcpServers.map((server) => [server.id, server]),
    );

    for (const id of ["context7", "semi-mcp"]) {
      const server = byId.get(id);
      expect.soft(server, `${id} should be imported`).toBeDefined();
      expect
        .soft(server?.workspacePath, `${id} should stay sandboxed`)
        .toBe(join(mcpWorkspaceRoot, id));
      expect
        .soft(server?.allowNetwork, `${id} requires explicit remote access`)
        .toBe(true);
    }
    expect(byId.get("localfiles")?.allowNetwork).toBe(true);
  });

  it("imports the current Codex Codegraph and Context7 stdio shapes", async () => {
    const { homePath, service } = await createService();
    await write(
      join(homePath, ".codex", "config.toml"),
      [
        "[mcp_servers.codegraph]",
        'command = "codegraph"',
        'args = ["serve", "--mcp"]',
        "",
        "[mcp_servers.context7]",
        'command = "npx"',
        'args = ["-y", "@upstash/context7-mcp@latest", "--api-key", "ctx7sk-test-placeholder"]',
      ].join("\n"),
    );

    const imported = await service.import({
      sources: ["codex"],
      categories: ["mcp"],
    });

    expect(imported.mcpServers).toEqual([
      expect.objectContaining({
        id: "codegraph",
        name: "codegraph",
        transport: "stdio",
        command: "codegraph",
        args: ["serve", "--mcp"],
      }),
      expect.objectContaining({
        id: "context7",
        name: "context7",
        transport: "stdio",
        command: "npx",
        args: [
          "-y",
          "@upstash/context7-mcp@latest",
          "--api-key",
          "ctx7sk-test-placeholder",
        ],
      }),
    ]);
  });

  it("previews Codex, OpenCode, and Claude Code without returning secrets", async () => {
    const { homePath, service } = await createService();
    await write(
      join(homePath, ".codex", "config.toml"),
      [
        'model = "gpt-5.6"',
        'model_provider = "openai"',
        "[mcp_servers.codex_docs]",
        'command = "npx"',
        'args = ["-y", "docs-mcp"]',
        "enabled = true",
        "[mcp_servers.codex_docs.env]",
        'SECRET = "must-not-leak"',
      ].join("\n"),
    );
    await write(join(homePath, ".codex", "AGENTS.md"), "# Codex global\n");
    await addSkill(join(homePath, ".codex", "skills"), "codex-skill");

    await write(
      join(homePath, ".config", "opencode", "opencode.json"),
      `{
        // JSONC is valid OpenCode configuration.
        model: "anthropic/claude-sonnet-4-5",
        mcp: {
          browser: {
            type: "remote",
            url: "https://mcp.example.test",
            enabled: false,
          },
        },
      }`,
    );
    await write(
      join(homePath, ".config", "opencode", "AGENTS.md"),
      "# OpenCode global\n",
    );
    await addSkill(
      join(homePath, ".config", "opencode", "skills"),
      "opencode-skill",
    );

    await write(
      join(homePath, ".claude", "settings.json"),
      JSON.stringify({ model: "claude-opus-4-1", apiKey: "must-not-leak" }),
    );
    await write(
      join(homePath, ".claude.json"),
      JSON.stringify({
        mcpServers: {
          files: {
            type: "stdio",
            command: "node",
            args: ["server.js"],
            env: { TOKEN: "must-not-leak" },
          },
        },
      }),
    );
    await write(join(homePath, ".claude", "CLAUDE.md"), "# Claude global\n");
    await addSkill(join(homePath, ".claude", "skills"), "claude-skill");

    const preview = await service.scan();
    const serialized = JSON.stringify(preview);

    expect(preview.sources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: "codex",
          detected: true,
          counts: { instructions: 1, skills: 1, mcp: 1 },
        }),
        expect.objectContaining({
          source: "opencode",
          detected: true,
          counts: { instructions: 1, skills: 1, mcp: 1 },
        }),
        expect.objectContaining({
          source: "claude",
          detected: true,
          counts: { instructions: 1, skills: 1, mcp: 1 },
        }),
      ]),
    );
    expect(serialized).not.toContain("must-not-leak");
    expect(serialized).not.toContain('"model"');
  });

  it("selectively imports files and returns parsed settings without overwriting", async () => {
    const { homePath, skillsPath, globalPath, service } = await createService();
    await write(
      join(homePath, ".codex", "config.toml"),
      [
        'model = "gpt-5.6"',
        'model_provider = "openai"',
        'model_reasoning_effort = "high"',
        "[mcp_servers.docs]",
        'url = "https://mcp.example.test"',
        "enabled = false",
      ].join("\n"),
    );
    await write(
      join(homePath, ".codex", "AGENTS.md"),
      "# Imported Codex rule\n",
    );
    await addSkill(join(homePath, ".codex", "skills"), "shared-skill");
    await addSkill(skillsPath, "existing-skill");

    const first = await service.import({
      sources: ["codex"],
      categories: ["instructions", "skills", "mcp"],
    });
    const second = await service.import({
      sources: ["codex"],
      categories: ["instructions", "skills"],
    });

    expect(first.mcpServers).toEqual([
      expect.objectContaining({
        id: "docs",
        transport: "streamable-http",
        url: "https://mcp.example.test",
        enabled: false,
      }),
    ]);
    expect(first).not.toHaveProperty("models");
    expect(first).not.toHaveProperty("providers");
    expect(await readFile(globalPath, "utf8")).toContain(
      "# Imported Codex rule",
    );
    expect(
      await readFile(join(skillsPath, "shared-skill", "SKILL.md"), "utf8"),
    ).toContain("name: shared-skill");
    expect(second.summary.imported.instructions).toBe(0);
    expect(second.summary.imported.skills).toBe(0);
    expect(second.summary.skipped.length).toBeGreaterThan(0);
    expect(
      (await readFile(globalPath, "utf8")).match(/Imported Codex rule/g),
    ).toHaveLength(1);
  });
});
