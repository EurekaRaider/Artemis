import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const mainSource = readFileSync(
  fileURLToPath(new URL("../src/main/main.ts", import.meta.url)),
  "utf8",
);
const workerSource = readFileSync(
  fileURLToPath(new URL("../src/agent/agent-worker.ts", import.meta.url)),
  "utf8",
);
const hostMessagesSource = readFileSync(
  fileURLToPath(
    new URL("../../../packages/protocol/src/host-messages.ts", import.meta.url),
  ),
  "utf8",
);
const settingsSource = readFileSync(
  fileURLToPath(new URL("../src/renderer/SettingsPanel.tsx", import.meta.url)),
  "utf8",
);

function sourceBlock(
  source: string,
  startNeedle: string,
  endNeedle: string,
): string {
  const start = source.indexOf(startNeedle);
  expect(start, `Missing source marker: ${startNeedle}`).toBeGreaterThan(-1);
  const end = source.indexOf(endNeedle, start + startNeedle.length);
  expect(end, `Missing source marker: ${endNeedle}`).toBeGreaterThan(start);
  return source.slice(start, end);
}

describe("memory turn integration contract", () => {
  it("carries hidden memory context through the turn command and worker", () => {
    const turnCommand = sourceBlock(
      hostMessagesSource,
      'type: "turn.prompt"',
      'type: "turn.cancel"',
    );
    const workerPrompt = sourceBlock(
      workerSource,
      'case "turn.prompt"',
      'case "turn.cancel"',
    );

    expect(turnCommand).toContain("memoryContext?: string");
    expect(workerPrompt).toContain("command.memoryContext");
  });

  it("recalls project memory first without changing the persisted user message", () => {
    const turnStart = sourceBlock(
      mainSource,
      "async function startTaskTurn",
      "async function queueTurn",
    );
    const initialTurn = sourceBlock(
      mainSource,
      "function emitInitialTurn",
      "function publishAutomationEvent",
    );
    const userEvent = sourceBlock(
      initialTurn,
      'type: "user.message"',
      'type: "turn.started"',
    );
    const agentCommand = sourceBlock(
      turnStart,
      'type: "turn.prompt"',
      ".catch((error)",
    );

    expect(turnStart).toContain("recallMemoryForTurn");
    expect(turnStart).toContain(
      "const [projectMemory, globalMemory] = await Promise.all([",
    );
    expect(turnStart).toContain(
      "[, memoryContext] = await Promise.all([openPromise, memoryPromise])",
    );
    expect(turnStart.indexOf("projectMemory")).toBeLessThan(
      turnStart.indexOf("globalMemory"),
    );
    expect(userEvent).toContain("text");
    expect(userEvent).not.toContain("memoryContext");
    expect(turnStart).toContain(
      "emitInitialTurn(thread.id, turnId, requestText",
    );
    expect(agentCommand).toContain("text: requestText");
    expect(agentCommand).toContain("memoryContext");
  });

  it("resolves brokered appends to fixed project or global memory paths", () => {
    const brokerRequest = sourceBlock(
      hostMessagesSource,
      'kind: "memory.append"',
      'kind: "workspace.write"',
    );

    expect(brokerRequest).toContain('scope: "project" | "global"');
    expect(brokerRequest).toContain("workspacePath: string");
    expect(brokerRequest).toContain("title: string");
    expect(brokerRequest).toContain("content: string");
    expect(brokerRequest).toContain("keywords: string[]");
    expect(brokerRequest).not.toMatch(/\bpath\s*:/u);
    expect(mainSource).toContain('case "memory.append"');
    expect(mainSource).toContain('".artemis"');
    expect(mainSource).toContain('".pi"');
    expect(mainSource).toContain('"MEMORY.md"');
    expect(mainSource).toContain("thread.mode !== request.mode");

    const appendHandler = sourceBlock(
      mainSource,
      "async function handleMemoryAppendBrokerRequest",
      "async function handleOfficeDocumentBrokerRequest",
    );
    expect(appendHandler).toContain('request.scope === "global"');
    expect(appendHandler).not.toContain("cross-project");
    expect(appendHandler).not.toContain("across repositories");
    expect(appendHandler).not.toContain("any repository");
  });

  it("keeps Memory automatic instead of adding a Settings editor", () => {
    expect(settingsSource).not.toContain("saveMemory");
    expect(settingsSource).not.toContain("MEMORY.md");
  });
});
