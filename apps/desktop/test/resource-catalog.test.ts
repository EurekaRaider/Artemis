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

  it("maps only fixed streamable HTTP MCP endpoints to one-click installs", () => {
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
            name: "io.example/templated",
            description: "Needs setup",
            version: "1.0.0",
            remotes: [
              {
                type: "streamable-http",
                url: "{baseUrl}/mcp",
                variables: { baseUrl: { isRequired: true } },
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
    });
    expect(items[1]).toMatchObject({
      registryName: "io.example/templated",
      installable: false,
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
