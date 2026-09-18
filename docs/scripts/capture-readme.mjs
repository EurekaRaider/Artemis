// Capture the real desktop with isolated demonstration data; no provider turn is sent.
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile } from "node:fs/promises";
import { tmpdir, userInfo } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL, fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
const { _electron } = await import(
  process.env.ARTEMIS_PLAYWRIGHT_MODULE || "playwright"
);

const root = fileURLToPath(new URL("../../", import.meta.url));
assert.equal(
  process.platform,
  "darwin",
  "This screenshot recipe uses the macOS titlebar inset.",
);
const require = createRequire(join(root, "package.json"));
const temp = await mkdtemp(join(tmpdir(), "artemis-readme-"));
const data = join(temp, "user-data"),
  project = join(temp, "field-notes");
const out = process.argv[2] || join(root, "docs/images/screenshots");
await Promise.all([
  mkdir(data),
  mkdir(project),
  mkdir(out, { recursive: true }),
]);
const { build } = require("esbuild");
await build({
  entryPoints: [join(root, "apps/desktop/src/main/store.ts")],
  outfile: join(temp, "store.mjs"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node24",
  logLevel: "silent",
});
const { AppStore } = await import(pathToFileURL(join(temp, "store.mjs")).href);
const store = new AppStore(join(data, "artemis.sqlite"));
const now = new Date().toISOString();
store.upsertProject({
  id: "demo-project",
  name: "Field Notes",
  path: project,
  createdAt: now,
  updatedAt: now,
});
for (const [id, title] of [
  ["demo-thread", "Build a searchable research library"],
  ["demo-report", "Prepare the weekly research brief"],
  ["demo-review", "Review the search experience"],
  ["demo-group", "Research team · Group collaboration"],
  ["demo-group-entry", "Research team"],
]) {
  store.createThread({
    id,
    projectId: "demo-project",
    title,
    mode: "execute",
    target: "local",
    status: "completed",
    pinned: false,
    archived: false,
    createdAt: now,
    updatedAt: now,
  });
}
const answer = `The research library is ready to review.\n\n### A focused place for your sources\n\n- **Search as you type** across titles and tags.\n- **Keep the context** with source links and concise notes.\n- **Continue where you left off** with saved project tasks.\n\n### What changed\n\n| File | Update |\n| --- | --- |\n| \`src/search.ts\` | Trim queries and match titles and tags |\n| \`README.md\` | Document the search workflow |\n\nOpen **Review** to inspect the changes, or use **Files** to read the project notes.\n\nThe layout and source checks are complete. The next step is to try the experience with your own research collection.`;
const events = [
  {
    type: "user.message",
    messageId: "demo-user",
    text: "Build a small research library with title and tag search. Keep the interface focused, and leave the changes ready for review.",
  },
  { type: "turn.started", mode: "execute" },
  {
    type: "message.part.delta",
    partId: "demo-answer",
    partType: "text",
    delta: answer,
  },
  {
    type: "assistant.usage",
    inputTokens: 18400,
    outputTokens: 2600,
    cacheReadTokens: 42000,
    cacheWriteTokens: 0,
    totalTokens: 63000,
  },
  {
    type: "turn.completed",
    reason: "completed",
    finalPartId: "demo-answer",
    durationMs: 148000,
  },
  {
    type: "agent-team.status",
    teamId: "demo-team",
    mission: "Research library",
    status: "completed",
    memberAgentIds: ["demo-ux", "demo-code"],
    requiredAgentIds: ["demo-ux", "demo-code"],
    maxMembers: 8,
    updatedAt: now,
  },
  {
    type: "child-agent.status",
    agentId: "demo-ux",
    teamId: "demo-team",
    label: "Search experience",
    status: "completed",
    task: "Review search states, keyboard navigation and empty results.",
    output:
      "Search feedback is concise. Keyboard focus stays visible, and the empty state explains how to broaden a query.",
    updatedAt: now,
  },
  {
    type: "child-agent.status",
    agentId: "demo-code",
    teamId: "demo-team",
    label: "Implementation review",
    status: "completed",
    task: "Check query normalization and matching behavior.",
    output:
      "Queries are trimmed and matched against both titles and tags. The change is limited to the search function and its documentation.",
    updatedAt: now,
  },
  {
    type: "task.source.added",
    sourceId: "demo-source",
    kind: "file",
    name: "README.md",
    mimeType: "text/markdown",
  },
];
events.forEach((payload, i) =>
  store.appendEvent("demo-event-" + i, "demo-thread", "demo-turn", payload),
);
for (const [i, name] of [
  "Weekly research brief",
  "Review project changes",
].entries())
  store.createAutomation({
    id: "demo-auto-" + i,
    projectId: "demo-project",
    name,
    prompt: i
      ? "Review recent project changes and summarize follow-up work."
      : "Summarize the research notes added this week and prepare a concise brief with source links.",
    mode: i ? "review" : "plan",
    target: "local",
    schedule: {
      kind: "weekly",
      daysOfWeek: [5],
      localTime: "09:00",
      timeZone: "Asia/Shanghai",
    },
    enabled: false,
    authorizationState: "not-required",
    createdAt: now,
    updatedAt: now,
  });
store.appendEvent("demo-group-user", "demo-group", "demo-group-turn", {
  type: "user.message",
  messageId: "demo-group-message",
  text: "Compare the research sources and prepare a shared summary for the team.",
});
store.appendEvent("demo-group-answer", "demo-group", "demo-group-turn", {
  type: "message.part.delta",
  partId: "demo-group-result",
  partType: "text",
  delta:
    "### Research team update\n\nThe shared brief is ready for review.\n\n- **Research Agent** checked the source notes.\n- **Review Agent** reviewed the summary and follow-up questions.\n\nAssignments and results travel through the same Slack channel. Each bot runs on its own Artemis desktop with independent project permissions.\n\nChoose a member from the panel to address the next task.",
});
store.close();
const git = (args) =>
  execFileSync("git", args, { cwd: project, stdio: "ignore" });
git(["init", "-b", "main"]);
await mkdir(join(project, "src"));
await writeFile(
  join(project, "src/search.ts"),
  `export interface Note {\n  title: string;\n  tags: string[];\n  source: string;\n}\n\nexport function searchNotes(notes: Note[], query: string): Note[] {\n  return notes.filter((note) => note.title.includes(query));\n}\n`,
);
await writeFile(
  join(project, "README.md"),
  "# Field Notes\n\nA focused research library for useful ideas.\n",
);
git(["add", "."]);
git([
  "-c",
  "user.name=Artemis Demo",
  "-c",
  "user.email=demo@example.invalid",
  "commit",
  "-m",
  "Create research library",
]);
git(["checkout", "-b", "search-library"]);
await writeFile(
  join(project, "src/search.ts"),
  `export interface Note {\n  title: string;\n  tags: string[];\n  source: string;\n}\n\nexport function searchNotes(notes: Note[], query: string): Note[] {\n  const normalized = query.trim().toLocaleLowerCase();\n  if (!normalized) return notes;\n\n  return notes.filter((note) => {\n    const searchable = [note.title, ...note.tags].join(' ');\n    return searchable.toLocaleLowerCase().includes(normalized);\n  });\n}\n`,
);
await writeFile(
  join(project, "README.md"),
  `# Field Notes\n\nA focused research library for useful ideas.\n\n## Find the note you need\n\nSearch titles and tags from one place. Queries ignore case and surrounding spaces. Clear the query to return to your full collection.\n\n## Research workflow\n\n1. Capture an idea with its source link.\n2. Add a few descriptive tags.\n3. Search your collection while writing.\n4. Turn the useful findings into a weekly brief.\n\n## Project structure\n\n| File | Purpose |\n| --- | --- |\n| src/search.ts | Title and tag matching |\n| README.md | Research workflow |\n\n> Keep the source close to the idea. A good note makes the next piece of work easier.\n`,
);
const env = { ...process.env };
for (const k of Object.keys(env))
  if (
    k === "ELECTRON_RUN_AS_NODE" ||
    k === "ARTEMIS_DEV_SERVER_URL" ||
    k.startsWith("ARTEMIS_SMOKE_")
  )
    delete env[k];
const app = await _electron.launch({
  executablePath: require("electron"),
  args: [join(root, "apps/desktop"), `--user-data-dir=${data}`],
  env,
  timeout: 30000,
});
const page = await app.firstWindow();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const screenshots = [];
let viewport;
async function capture(name, { keepEnvironment = false } = {}) {
  await page.waitForTimeout(700);
  const closeEnvironment = page.locator(
    ".environment-panel-header .environment-header-action",
  );
  if (!keepEnvironment && (await closeEnvironment.isVisible()))
    await closeEnvironment.click();
  await page.mouse.move(300, 20);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(350);
  const visibleText = await page.locator("body").innerText();
  const localName = userInfo().username.toLowerCase();
  if (localName !== "artemis") {
    assert.ok(
      !visibleText.toLowerCase().includes(localName),
      "Personal name must not appear in documentation screenshots.",
    );
  }
  assert.ok(
    !visibleText.includes("/Users/"),
    "Personal home paths must not appear in documentation screenshots.",
  );
  await writeFile(join(temp, name + ".txt"), visibleText);
  await page.screenshot({
    path: join(out, name + ".png"),
    scale: "css",
  });
  const bytes = await readFile(join(out, name + ".png"));
  screenshots.push({
    file: name + ".png",
    ...viewport,
    bytes: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  });
  console.log("captured", name);
}
async function dock(label) {
  if (
    (await page
      .locator(".right-sidebar-toggle")
      .getAttribute("aria-expanded")) !== "true"
  )
    await page.locator(".right-sidebar-toggle").click();
  await page.locator(".workspace-tab-add").click();
  await page
    .locator(".workspace-tab-menu")
    .getByRole("button", { name: label, exact: true })
    .click();
}
async function openDemoGroup() {
  await page
    .locator(".sidebar-footer")
    .getByRole("button", { name: "Settings", exact: true })
    .click();
  await page.locator("#settings-tab-im-button").click();
  await page
    .locator(".im-overview-actions")
    .getByRole("button", {
      name: "Project and collaboration permissions",
      exact: true,
    })
    .click();
  await page.locator('#im-spaces [aria-haspopup="listbox"]').click();
  await page.getByRole("option", { name: /Research team/ }).click();
  await page
    .locator("#im-spaces")
    .getByRole("button", { name: "Open group conversation", exact: true })
    .click();
  await page.waitForSelector(".composer");
}
try {
  await page.waitForFunction(() => !!window.artemis);
  // Substitute only the presentation identity in this isolated capture process.
  // Electron's private handler map is test instrumentation, never shipped code.
  await app.evaluate(({ ipcMain }) => {
    const channel = "artemis:snapshot";
    const original = ipcMain._invokeHandlers.get(channel);
    if (!original)
      throw new Error("Snapshot handler unavailable for demo identity.");
    // Global Skills live outside userData; never expose that personal catalog.
    ipcMain.removeHandler("artemis:resource-skill-list");
    ipcMain.handle("artemis:resource-skill-list", () => []);
    ipcMain.removeHandler("artemis:project-pull-request");
    ipcMain.handle("artemis:project-pull-request", () => ({
      status: "not-found",
    }));
    ipcMain.removeHandler(channel);
    ipcMain.handle(channel, async (...args) => ({
      ...(await original(...args)),
      userName: "Artemis",
    }));
  });
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setContentSize(1440, 850),
  );
  viewport = await page.evaluate(() => ({
    width: innerWidth,
    height: innerHeight,
  }));
  await page.evaluate(async () => {
    await window.artemis.setWorkspaceDockWidth(560);
    await window.artemis.setLanguage("en");
    await window.artemis.setTheme("light");
  });
  await page.reload();
  await page.waitForSelector(".composer");
  await page.waitForTimeout(700);
  await page
    .getByText("Build a searchable research library", { exact: true })
    .first()
    .click();
  const later = page.getByRole("button", {
    name: /Not now|Later|暂不/,
    exact: true,
  });
  if (await later.count()) await later.first().click();
  if (
    (await page
      .locator(".right-sidebar-toggle")
      .getAttribute("aria-expanded")) === "true"
  )
    await page.locator(".right-sidebar-toggle").click();
  await capture("workspace-light");
  await page.locator(".environment-trigger").click();
  await capture("environment-panel-light", { keepEnvironment: true });
  await page.evaluate(() => window.artemis.setTheme("dark"));
  await page.reload();
  await page.waitForSelector(".composer");
  await page
    .getByText("Build a searchable research library", { exact: true })
    .first()
    .click();
  await capture("workspace-dark");
  await page.locator(".environment-trigger").click();
  await capture("environment-panel-dark", { keepEnvironment: true });
  await page.evaluate(() => window.artemis.setTheme("light"));
  await page.reload();
  await page.waitForSelector(".composer");
  await page
    .getByText("Build a searchable research library", { exact: true })
    .first()
    .click();
  await dock("Review");
  await page.locator(".review-scope-select").getByRole("button").click();
  await page.getByRole("option", { name: "Unstaged", exact: true }).click();
  await page.waitForTimeout(700);
  await page.getByText("src/search.ts", { exact: true }).last().click();
  await capture("git-review");
  await dock("Files");
  await page
    .locator('[data-artemis-component="workspace-file-tree-row"]:visible')
    .filter({ hasText: "README.md" })
    .click();
  await page
    .locator(".workspace-files-panel > .workspace-panel-toolbar")
    .getByRole("button", { name: /reader/i })
    .click();
  await capture("markdown-files");
  await dock("Terminal");
  await page.locator(".terminal-host").click();
  await page.keyboard.type(
    "PS1='Field Notes % '; printf '\\033[2J\\033[3J\\033[H'; git status --short",
  );
  await page.keyboard.press("Enter");
  await page.waitForTimeout(500);
  await capture("terminal");
  await page.locator(".environment-trigger").click();
  await page
    .locator(".environment-popover")
    .getByRole("button", { name: "Details", exact: true })
    .click();
  await capture("agent-team");
  await page
    .locator(".sidebar-footer")
    .getByRole("button", { name: "Settings", exact: true })
    .click();
  await page.locator("#settings-tab-general-button").click();
  await capture("settings-general");
  // Synthetic transport responses exercise the real IM views without accounts or network calls.
  await app.evaluate(({ ipcMain }) => {
    const identity = {
      channel: "slack",
      connectionId: "demo-slack",
      tenantId: "demo-team",
      appId: "demo-app",
      userId: "demo-owner",
    };
    const conversation = {
      connectionId: "demo-slack",
      id: "demo-channel",
      kind: "group",
    };
    const members = [
      {
        deviceId: "demo-device",
        name: "Research Agent",
        deviceName: "Demo workstation",
        state: "online",
        identity,
      },
    ];
    const roster = {
      complete: true,
      members: [
        {
          identity,
          name: "Team owner",
          kind: "human",
          presence: "active",
          presenceCheckedAt: Date.now(),
          canAssign: true,
        },
        {
          identity: { ...identity, userId: "demo-reviewer" },
          name: "Team reviewer",
          kind: "human",
          presence: "away",
          presenceCheckedAt: Date.now(),
          canAssign: true,
        },
        {
          identity: { ...identity, userId: "demo-research-bot" },
          name: "Research Agent",
          kind: "bot",
          self: true,
        },
        {
          identity: { ...identity, userId: "demo-review-bot" },
          name: "Review Agent",
          kind: "bot",
          canAssign: true,
          verifiedAt: Date.now(),
        },
      ],
    };
    const space = {
      id: "demo-group-space",
      name: "Research team",
      revision: "demo-revision",
      confirmed: true,
      endpoints: [conversation],
      participants: members,
      administrators: [identity],
      nativeGroup: {
        enabled: true,
        enabledAt: Date.now(),
        ownerDeviceId: "demo-device",
        projectId: "demo-project",
        capability: "events",
        allowedBots: ["demo-review-bot"],
      },
    };
    const status = {
      state: "connected",
      scopedShellSupported: true,
      scopedFileCreationSupported: true,
      localGateway: { state: "running" },
      settings: {
        enabled: true,
        gatewayUrl: "http://127.0.0.1:8787",
        deviceId: "demo-device",
        deviceName: "Demo workstation",
        defaultProjectId: "demo-project",
        grants: [
          {
            projectId: "demo-project",
            mode: "plan",
            approval: "ask",
            network: false,
            shell: false,
            tokenBudget: 100000,
            groups: ["space:demo-group-space"],
            security: {
              version: 2,
              revision: "demo-grant",
              confirmedAt: Date.now(),
              scopes: [{ audience: "owner", readPaths: [], writePaths: [] }],
            },
            expiresAt: Date.now() + 86400000,
          },
        ],
      },
      identities: [identity],
      pairingRequests: [],
      spaces: [space],
      connections: [
        {
          id: "demo-slack",
          name: "Research Slack",
          channel: "slack",
          state: "connected",
        },
      ],
      remoteTasks: [
        {
          threadId: "demo-group",
          parentThreadId: "demo-group-entry",
          channel: "slack",
          kind: "group",
          connectionState: "connected",
          group: {
            spaceId: space.id,
            name: space.name,
            confirmed: true,
            native: true,
            executingDeviceId: "demo-device",
            stale: false,
            members,
            roster,
          },
        },
      ],
    };
    status.remoteTasks.push({
      ...status.remoteTasks[0],
      threadId: "demo-group-entry",
      parentThreadId: undefined,
    });
    const diagnostics = {
      devices: [{ id: "demo-device", name: "Demo workstation" }],
      identities: [{ identity, deviceId: "demo-device" }],
      groups: [
        {
          conversation,
          name: "Research team",
          platform: "slack",
          identities: [identity],
          lastSeenAt: Date.now(),
        },
      ],
      spaces: [space],
      deliveries: [],
    };
    ipcMain.removeHandler("artemis:im-status");
    ipcMain.handle("artemis:im-status", () => status);
    ipcMain.removeHandler("artemis:im-manage");
    ipcMain.handle("artemis:im-manage", (_event, request) => {
      if (request.action === "refresh") return status;
      if (
        request.action === "admin" &&
        ["status", "refresh-groups"].includes(request.operation)
      )
        return diagnostics;
      throw new Error(
        "Documentation capture permits read-only status requests only.",
      );
    });
  });
  await page.locator("#settings-tab-im-button").click();
  await page.waitForSelector(".im-settings[data-mode=overview]");
  await capture("im-connections");
  await page
    .locator(".im-overview-actions")
    .getByRole("button", {
      name: "Project and collaboration permissions",
      exact: true,
    })
    .click();
  await page.locator("#im-spaces").waitFor();
  const groupSelect = page.locator('#im-spaces [aria-haspopup="listbox"]');
  await groupSelect.click();
  await page.getByRole("option", { name: /Research team/ }).click();
  await page.locator("#im-spaces").scrollIntoViewIfNeeded();
  await capture("im-spaces");
  await page.locator(".settings-header").getByRole("button").click();
  for (const [view, name] of [
    ["resources", "resources"],
    ["token-usage", "token-usage"],
    ["automations", "automations"],
  ]) {
    await page.locator(`.sidebar-nav [data-nav-view="${view}"]`).click();
    await page.waitForTimeout(600);
    await capture(name);
  }
  await openDemoGroup();
  if (
    (await page
      .locator(".right-sidebar-toggle")
      .getAttribute("aria-expanded")) === "true"
  )
    await page.locator(".right-sidebar-toggle").click();
  await page.waitForTimeout(800);
  if (
    (await page
      .locator(".environment-trigger")
      .getAttribute("aria-expanded")) !== "true"
  )
    await page.locator(".environment-trigger").click();
  await page.waitForSelector(".im-group-members");
  await capture("im-group-chat", { keepEnvironment: true });
  await page.evaluate(() => window.artemis.setTheme("dark"));
  await page.reload();
  await page.waitForSelector(".composer");
  await openDemoGroup();
  await page.waitForTimeout(800);
  if (
    (await page
      .locator(".environment-trigger")
      .getAttribute("aria-expanded")) !== "true"
  )
    await page.locator(".environment-trigger").click();
  await page.waitForSelector(".im-group-members");
  await capture("im-group-chat-dark", { keepEnvironment: true });
  await page.evaluate(() => window.artemis.setTheme("light"));
  await page.evaluate(() => window.artemis.setLanguage("zh-CN"));
  await page.reload();
  await page.waitForSelector(".composer");
  await page
    .getByText("Build a searchable research library", { exact: true })
    .first()
    .click();
  if (
    (await page
      .locator(".right-sidebar-toggle")
      .getAttribute("aria-expanded")) === "true"
  )
    await page.locator(".right-sidebar-toggle").click();
  await capture("workspace-zh-CN");
  assert.deepEqual(errors, []);
  const security = await app.evaluate(({ BrowserWindow }) => {
    const p =
      BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences();
    return {
      sandbox: p.sandbox,
      contextIsolation: p.contextIsolation,
      nodeIntegration: p.nodeIntegration,
    };
  });
  console.log("Isolated privacy audit text:", temp);
  const report = {
    version: 1,
    capturedAt: new Date().toISOString(),
    appVersion: JSON.parse(await readFile(join(root, "package.json"), "utf8"))
      .version,
    sourceHead: execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: root,
      encoding: "utf8",
    }).trim(),
    sourceState:
      "Local working tree, including in-progress changes present at capture time.",
    platform: "macOS " + process.arch,
    renderer: "Production Electron build",
    viewport,
    data: "Isolated synthetic project, conversation, usage, agent, IM roster/status and disabled automation fixtures. IM transport responses are synthetic; no real IM service was contacted. Presentation identity replaced with Artemis in the isolated snapshot handler. No provider turn was submitted. Application viewport captured without cropping.",
    privacy: {
      displayName: "Artemis",
      visiblePersonalNames: false,
      visibleHomePaths: false,
    },
    security,
    errors,
    screenshots,
  };
  await writeFile(
    join(out, "manifest.json"),
    JSON.stringify(report, null, 2) + "\n",
  );
  await writeFile(
    join(out, "environment-manifest.json"),
    JSON.stringify(
      {
        ...report,
        screenshots: screenshots.filter((shot) =>
          shot.file.startsWith("environment-panel-"),
        ),
      },
      null,
      2,
    ) + "\n",
  );
} catch (e) {
  await page.screenshot({ path: join(temp, "failure.png") });
  console.log("failure screenshot", join(temp, "failure.png"));
  throw e;
} finally {
  await app.close();
}
