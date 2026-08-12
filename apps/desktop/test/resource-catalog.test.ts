import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  ResourceCatalogService,
  parseMcpCatalogResponse,
  parseSkillFrontmatter,
} from "../src/main/resource-catalog.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("resource catalog", () => {
  it("accepts capitalized Skill names used by official Codex plugins", () => {
    expect(
      parseSkillFrontmatter(
        "---\nname: Zotero\ndescription: Work with a local Zotero library.\n---\n",
      ),
    ).toEqual({
      name: "Zotero",
      description: "Work with a local Zotero library.",
    });
  });

  it("migrates valid LightningStorm Skill metadata without changing Skill content", async () => {
    const directory = await mkdtemp(join(tmpdir(), "artemis-skills-"));
    temporaryDirectories.push(directory);
    const skillDirectory = join(directory, "brainstorming");
    await mkdir(skillDirectory);
    const skillBody =
      "---\nname: brainstorming\ndescription: Explore ideas safely.\n---\n\n# Brainstorming\n";
    await writeFile(join(skillDirectory, "SKILL.md"), skillBody);
    const metadata = {
      version: 1,
      id: "codex-plugin/superpowers/brainstorming",
      source: "codex-plugin:superpowers",
      installedAt: "2026-08-04T04:58:51.462Z",
    };
    await writeFile(
      join(skillDirectory, ".lightningstorm-skill.json"),
      `${JSON.stringify(metadata, undefined, 2)}\n`,
    );
    const service = new ResourceCatalogService(directory);

    await expect(service.listInstalledSkills()).resolves.toEqual([
      expect.objectContaining({
        id: metadata.id,
        source: metadata.source,
        installedAt: metadata.installedAt,
      }),
    ]);
    await expect(
      readFile(join(skillDirectory, ".artemis-skill.json"), "utf8"),
    ).resolves.toContain(metadata.id);
    await expect(
      access(join(skillDirectory, ".lightningstorm-skill.json")),
    ).rejects.toMatchObject({ code: "ENOENT" });
    await expect(
      readFile(join(skillDirectory, "SKILL.md"), "utf8"),
    ).resolves.toBe(skillBody);
  });

  it("leaves invalid legacy Skill metadata untouched", async () => {
    const directory = await mkdtemp(join(tmpdir(), "artemis-skills-"));
    temporaryDirectories.push(directory);
    const skillDirectory = join(directory, "local-skill");
    await mkdir(skillDirectory);
    await writeFile(
      join(skillDirectory, "SKILL.md"),
      "---\nname: local-skill\ndescription: Remains local.\n---\n",
    );
    await writeFile(
      join(skillDirectory, ".lightningstorm-skill.json"),
      '{"version":1,"id":"missing-fields"}\n',
    );
    const service = new ResourceCatalogService(directory);

    await expect(service.listInstalledSkills()).resolves.toEqual([
      expect.objectContaining({ id: "local/local-skill" }),
    ]);
    await expect(
      readFile(join(skillDirectory, ".lightningstorm-skill.json"), "utf8"),
    ).resolves.toContain("missing-fields");
    await expect(
      access(join(skillDirectory, ".artemis-skill.json")),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("maps fixed HTTP, authenticated HTTP, and npm stdio MCP install plans", () => {
    const items = parseMcpCatalogResponse({
      servers: [
        {
          server: {
            name: "io.example/weather",
            title: "Weather",
            description: "Weather tools",
            version: "1.2.3",
            repository: {
              url: "https://github.com/example/weather",
              source: "github",
            },
            remotes: [
              {
                type: "streamable-http",
                url: "https://weather.example.com/mcp",
              },
            ],
          },
        },
        {
          server: {
            name: "ai.smithery/context7fork",
            description: "Authenticated Context7 fork",
            version: "1.0.13",
            remotes: [
              {
                type: "streamable-http",
                url: "https://server.smithery.ai/context7/mcp",
                headers: [
                  {
                    name: "Authorization",
                    description: "Bearer token for Smithery authentication",
                    value: "Bearer {smithery_api_key}",
                  },
                ],
              },
            ],
          },
        },
        {
          server: {
            name: "com.clauxel/context7docs-mcp",
            description: "Private Context7 documentation",
            version: "1.0.0",
            remotes: [
              {
                type: "streamable-http",
                url: "https://context7docs.example/mcp",
                headers: [
                  {
                    name: "Authorization",
                    description: "Bearer token from the product website.",
                  },
                ],
              },
            ],
          },
        },
        {
          server: {
            name: "io.github.upstash/context7",
            title: "Context7",
            description: "Up-to-date code docs for any prompt",
            version: "1.0.31",
            packages: [
              {
                registryType: "npm",
                identifier: "@upstash/context7-mcp",
                version: "1.0.31",
                transport: { type: "stdio" },
                environmentVariables: [
                  {
                    name: "CONTEXT7_API_KEY",
                    description: "API key for authentication",
                    isSecret: true,
                  },
                ],
              },
            ],
          },
        },
        {
          server: {
            name: "io.example/templated",
            description: "Needs a tenant URL",
            version: "1.0.0",
            remotes: [
              {
                type: "streamable-http",
                url: "https://{tenant}.example.com/mcp",
                variables: { tenant: { isRequired: true } },
              },
            ],
          },
        },
      ],
    });

    expect(items[0]).toMatchObject({
      registryName: "io.example/weather",
      title: "Weather",
      remoteUrl: "https://weather.example.com/mcp",
      installable: true,
      installMode: "ready",
      installOption: {
        id: "remote-0",
        kind: "remote",
        inputs: [],
      },
    });
    expect(items[1]).toMatchObject({
      registryName: "ai.smithery/context7fork",
      installable: true,
      installMode: "needs-input",
      installOption: {
        id: "remote-0",
        kind: "remote",
        inputs: [
          {
            id: "header.0.smithery_api_key",
            required: true,
            secret: true,
          },
        ],
      },
    });
    expect(items[2]).toMatchObject({
      registryName: "com.clauxel/context7docs-mcp",
      installMode: "needs-input",
      installOption: {
        id: "remote-0",
        inputs: [
          {
            id: "header.0.value",
            label: "Authorization",
            required: true,
            secret: true,
          },
        ],
      },
    });
    expect(items[3]).toMatchObject({
      registryName: "io.github.upstash/context7",
      installMode: "needs-input",
      installOption: {
        id: "npm-0",
        kind: "npm-stdio",
        detail: "npx -y @upstash/context7-mcp@1.0.31",
        inputs: [
          {
            id: "env.CONTEXT7_API_KEY",
            required: false,
            secret: true,
          },
        ],
      },
    });
    expect(items[4]).toMatchObject({
      registryName: "io.example/templated",
      installable: false,
      installMode: "unsupported",
      reason: expect.stringContaining("URL variables"),
    });
  });

  it("resolves a pinned Context7 npm package without persisting its API key", async () => {
    const directory = await mkdtemp(join(tmpdir(), "artemis-mcp-catalog-"));
    temporaryDirectories.push(directory);
    const fetcher: typeof fetch = async () =>
      Response.json({
        server: {
          name: "io.github.upstash/context7",
          title: "Context7",
          description: "Up-to-date code docs for any prompt",
          version: "1.0.31",
          packages: [
            {
              registryType: "npm",
              identifier: "@upstash/context7-mcp",
              version: "1.0.31",
              transport: { type: "stdio" },
              environmentVariables: [
                {
                  name: "CONTEXT7_API_KEY",
                  description: "API key for authentication",
                  isSecret: true,
                },
              ],
            },
          ],
        },
      });
    const service = new ResourceCatalogService(directory, fetcher);

    await expect(
      service.resolveMcpInstall(
        "io.github.upstash/context7",
        "1.0.31",
        "npm-0",
        { "env.CONTEXT7_API_KEY": "ctx-secret" },
      ),
    ).resolves.toEqual({
      config: expect.objectContaining({
        name: "Context7",
        transport: "stdio",
        command: "npx",
        args: ["-y", "@upstash/context7-mcp@1.0.31"],
        env: {},
        credentialEnvVars: ["CONTEXT7_API_KEY"],
        allowNetwork: true,
      }),
      secrets: { env: { CONTEXT7_API_KEY: "ctx-secret" }, headers: {} },
    });
  });

  it("resolves authenticated HTTP headers from user input and rejects missing values", async () => {
    const directory = await mkdtemp(join(tmpdir(), "artemis-mcp-catalog-"));
    temporaryDirectories.push(directory);
    const fetcher: typeof fetch = async () =>
      Response.json({
        server: {
          name: "ai.smithery/context7fork",
          title: "Context7 fork",
          description: "Authenticated Context7 fork",
          version: "1.0.13",
          remotes: [
            {
              type: "streamable-http",
              url: "https://server.smithery.ai/context7/mcp",
              headers: [
                {
                  name: "Authorization",
                  value: "Bearer {smithery_api_key}",
                },
              ],
            },
          ],
        },
      });
    const service = new ResourceCatalogService(directory, fetcher);

    await expect(
      service.resolveMcpInstall(
        "ai.smithery/context7fork",
        "1.0.13",
        "remote-0",
        {},
      ),
    ).rejects.toThrow(/smithery_api_key/u);
    await expect(
      service.resolveMcpInstall(
        "ai.smithery/context7fork",
        "1.0.13",
        "remote-0",
        { "header.0.smithery_api_key": "smithery-secret" },
      ),
    ).resolves.toEqual({
      config: expect.objectContaining({
        transport: "streamable-http",
        auth: "headers",
        headerNames: ["Authorization"],
      }),
      secrets: {
        env: {},
        headers: { Authorization: "Bearer smithery-secret" },
      },
    });
  });

  it("omits an optional Registry header when the user leaves it blank", async () => {
    const directory = await mkdtemp(join(tmpdir(), "artemis-mcp-catalog-"));
    temporaryDirectories.push(directory);
    const service = new ResourceCatalogService(directory, async () =>
      Response.json({
        server: {
          name: "io.example/optional-header",
          title: "Optional header",
          description: "Works without an API key",
          version: "1.0.0",
          remotes: [
            {
              type: "streamable-http",
              url: "https://example.test/mcp",
              headers: [
                { name: "X-Api-Key", isRequired: false, isSecret: true },
              ],
            },
          ],
        },
      }),
    );

    await expect(
      service.resolveMcpInstall(
        "io.example/optional-header",
        "1.0.0",
        "remote-0",
        {},
      ),
    ).resolves.toEqual({
      config: expect.objectContaining({ auth: "none" }),
      secrets: { env: {}, headers: {} },
    });
  });

  it("rejects Registry environment variables that can redirect package execution", () => {
    const [item] = parseMcpCatalogResponse({
      servers: [
        {
          server: {
            name: "io.example/unsafe-environment",
            description: "Attempts to change npm execution",
            version: "1.0.0",
            packages: [
              {
                registryType: "npm",
                identifier: "safe-package",
                version: "1.0.0",
                transport: { type: "stdio" },
                environmentVariables: [
                  { name: "NPM_CONFIG_REGISTRY", isRequired: true },
                ],
              },
            ],
          },
        },
      ],
    });

    expect(item).toMatchObject({
      installMode: "unsupported",
      installable: false,
      reason: expect.stringContaining("environment name"),
    });
  });

  it("installs a catalog skill atomically into the Pi global skill folder", async () => {
    const directory = await mkdtemp(join(tmpdir(), "artemis-skills-"));
    temporaryDirectories.push(directory);
    const fetcher: typeof fetch = async (input) => {
      const url = String(input);
      if (url.includes("/search?")) {
        return new Response(
          JSON.stringify({
            skills: [
              {
                id: "example/skills/archive-search",
                skillId: "archive-search",
                name: "Archive Search",
                source: "example/skills",
                installs: 42,
              },
            ],
          }),
        );
      }
      if (url === "https://api.github.com/repos/example/skills") {
        return new Response(JSON.stringify({ default_branch: "main" }));
      }
      if (url.includes("/git/trees/main?recursive=1")) {
        return new Response(
          JSON.stringify({
            truncated: false,
            tree: [
              {
                path: "skills/archive-search/SKILL.md",
                type: "blob",
                size: 102,
                sha: "skill-sha",
              },
              {
                path: "skills/archive-search/references/usage.md",
                type: "blob",
                size: 22,
                sha: "reference-sha",
              },
            ],
          }),
        );
      }
      if (url.endsWith("/skills/archive-search/SKILL.md")) {
        return new Response(
          "---\nname: archive-search\ndescription: Search archived conversations.\n---\n\n# Archive Search\n",
        );
      }
      if (url.endsWith("/skills/archive-search/references/usage.md")) {
        return new Response("Use the archive index.");
      }
      return new Response("Not found", { status: 404 });
    };
    const service = new ResourceCatalogService(directory, fetcher);

    expect(await service.searchSkills("archive")).toEqual([
      expect.objectContaining({
        id: "example/skills/archive-search",
        installed: false,
      }),
    ]);
    const progress: number[] = [];
    const installed = await service.installSkill(
      "example/skills/archive-search",
      (percent) => progress.push(percent),
    );

    expect(installed).toMatchObject({
      id: "example/skills/archive-search",
      name: "archive-search",
      source: "example/skills",
    });
    expect(progress[0]).toBeGreaterThan(0);
    expect(progress).toContain(100);
    expect(progress).toEqual([...progress].sort((left, right) => left - right));
    expect(
      await readFile(join(directory, "archive-search", "SKILL.md"), "utf8"),
    ).toContain("Search archived conversations");
    expect((await service.listInstalledSkills())[0]).toMatchObject({
      id: "example/skills/archive-search",
      name: "archive-search",
    });
  });

  it("rejects skill files that escape the installation directory", async () => {
    const directory = await mkdtemp(join(tmpdir(), "artemis-skills-"));
    temporaryDirectories.push(directory);
    const service = new ResourceCatalogService(directory, async (input) => {
      const url = String(input);
      if (url === "https://api.github.com/repos/example/skills") {
        return new Response(JSON.stringify({ default_branch: "main" }));
      }
      return new Response(
        JSON.stringify({
          truncated: false,
          tree: [
            {
              path: "skills/unsafe/SKILL.md",
              type: "blob",
              size: 60,
              sha: "skill-sha",
            },
            {
              path: "skills/unsafe/../escape.js",
              type: "blob",
              size: 3,
              sha: "escape-sha",
            },
          ],
        }),
      );
    });

    await expect(service.installSkill("example/skills/unsafe")).rejects.toThrow(
      "unsafe path",
    );
  });

  it("copies a local Skill with supported content folders atomically into the existing global root", async () => {
    const directory = await mkdtemp(join(tmpdir(), "artemis-skills-"));
    const source = await mkdtemp(join(tmpdir(), "artemis-local-skill-"));
    temporaryDirectories.push(directory, source);
    await writeFile(
      join(source, "SKILL.md"),
      "---\nname: local-authoring\ndescription: A local author Skill.\n---\n",
    );
    for (const folder of [
      "assets",
      "examples",
      "references",
      "scripts",
      "templates",
    ]) {
      await mkdir(join(source, folder));
      await writeFile(join(source, folder, "content.txt"), folder);
    }
    const service = new ResourceCatalogService(directory);

    const installed = await service.installLocalSkill(source);

    expect(installed).toMatchObject({
      id: "local/local-authoring",
      name: "local-authoring",
      description: "A local author Skill.",
      path: join(directory, "local-authoring"),
      enabled: true,
    });
    await expect(
      readFile(join(directory, "local-authoring", "SKILL.md"), "utf8"),
    ).resolves.toContain("name: local-authoring");
    await expect(
      Promise.all(
        ["assets", "examples", "references", "scripts", "templates"].map(
          (folder) =>
            readFile(
              join(directory, "local-authoring", folder, "content.txt"),
              "utf8",
            ),
        ),
      ),
    ).resolves.toEqual([
      "assets",
      "examples",
      "references",
      "scripts",
      "templates",
    ]);
    expect(
      (await readdir(directory)).filter((entry) =>
        entry.startsWith(".install-"),
      ),
    ).toEqual([]);
  });

  it.each([
    {
      name: "missing SKILL.md",
      prepare: async (source: string) => {
        await writeFile(join(source, "README.md"), "not a Skill");
      },
    },
    {
      name: "unsafe directory junction",
      prepare: async (source: string) => {
        await writeFile(
          join(source, "SKILL.md"),
          "---\nname: unsafe-link\ndescription: Must reject links.\n---\n",
        );
        const external = await mkdtemp(join(tmpdir(), "artemis-external-"));
        temporaryDirectories.push(external);
        await writeFile(join(external, "outside.md"), "outside");
        await symlink(external, join(source, "references"), "junction");
      },
    },
    {
      name: "package file limit",
      prepare: async (source: string) => {
        await writeFile(
          join(source, "SKILL.md"),
          "---\nname: too-many-files\ndescription: Must enforce limits.\n---\n",
        );
        await mkdir(join(source, "references"));
        await Promise.all(
          Array.from({ length: 200 }, (_, index) =>
            writeFile(join(source, "references", `${index}.md`), "x"),
          ),
        );
      },
    },
  ])(
    "rejects local Skills with $name without partial installation",
    async ({ prepare }) => {
      const directory = await mkdtemp(join(tmpdir(), "artemis-skills-"));
      const source = await mkdtemp(join(tmpdir(), "artemis-local-skill-"));
      temporaryDirectories.push(directory, source);
      await prepare(source);
      const service = new ResourceCatalogService(directory);

      await expect(service.installLocalSkill(source)).rejects.toThrow();

      await expect(readdir(directory)).resolves.toEqual([]);
    },
  );

  it("rejects a local Skill whose destination already exists without overwriting it", async () => {
    const directory = await mkdtemp(join(tmpdir(), "artemis-skills-"));
    const source = await mkdtemp(join(tmpdir(), "artemis-local-skill-"));
    temporaryDirectories.push(directory, source);
    await writeFile(
      join(source, "SKILL.md"),
      "---\nname: existing\ndescription: Incoming Skill.\n---\n",
    );
    await mkdir(join(directory, "existing"));
    await writeFile(join(directory, "existing", "preserve.txt"), "keep");
    const service = new ResourceCatalogService(directory);

    await expect(service.installLocalSkill(source)).rejects.toThrow(
      "already installed",
    );

    await expect(
      readFile(join(directory, "existing", "preserve.txt"), "utf8"),
    ).resolves.toBe("keep");
    await expect(
      access(join(directory, ".install-existing")),
    ).rejects.toThrow();
  });

  it("removes only an installed Skill from the managed global root", async () => {
    const directory = await mkdtemp(join(tmpdir(), "artemis-skills-"));
    const source = await mkdtemp(join(tmpdir(), "artemis-local-skill-"));
    temporaryDirectories.push(directory, source);
    await writeFile(
      join(source, "SKILL.md"),
      "---\nname: removable\ndescription: A removable Skill.\n---\n",
    );
    const service = new ResourceCatalogService(directory);
    await service.installLocalSkill(source);

    await service.removeSkill("local/removable");

    await expect(readdir(directory)).resolves.toEqual([]);
    await expect(service.removeSkill("local/removable")).rejects.toThrow(
      "not found",
    );
  });
});
