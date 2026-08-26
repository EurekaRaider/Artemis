import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const appSource = readFileSync(
  fileURLToPath(new URL("../src/renderer/App.tsx", import.meta.url)),
  "utf8",
);
const stylesSource = readFileSync(
  fileURLToPath(new URL("../src/renderer/styles.css", import.meta.url)),
  "utf8",
);

function sourceForConstant(name: string): string {
  const start = appSource.indexOf(`const ${name} =`);
  expect(start, `Missing ${name}`).toBeGreaterThan(-1);
  const end = appSource.indexOf("\n  const ", start + 1);
  return appSource.slice(start, end < 0 ? undefined : end);
}

function sourceForQueuedButton(className: string): string {
  const classIndex = appSource.indexOf(`className="${className}"`);
  expect(classIndex, `Missing ${className}`).toBeGreaterThan(-1);
  const start = appSource.lastIndexOf("<button", classIndex);
  const end = appSource.indexOf("</button>", classIndex);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return appSource.slice(start, end + "</button>".length);
}

describe("Codex-style queued message composer", () => {
  it("renders each queued message as a numbered card above the composer", () => {
    const barIndex = appSource.indexOf('className="queued-message-bar"');
    const listEnd = appSource.indexOf("</ol>", barIndex);
    const barSource = appSource.slice(barIndex, listEnd);

    expect(barIndex).toBeGreaterThan(-1);
    expect(listEnd).toBeGreaterThan(barIndex);
    expect(barSource).toContain("{queuedFollowUps.map");
    expect(barSource).toContain('className="queued-message-heading"');
    expect(barSource).toContain('className="queued-message-list"');
    expect(barSource).toContain('className="queued-message-item"');
    expect(barSource).toContain('className="queued-message-index"');
    expect(barSource).toContain('className="queued-message-actions"');

    const steerButton = sourceForQueuedButton("queued-message-steer");
    const prioritizeButton = sourceForQueuedButton("queued-message-prioritize");
    const deleteButton = sourceForQueuedButton("queued-message-delete");
    const editButton = sourceForQueuedButton("queued-message-edit");

    expect(steerButton).toContain("<SteerIcon />");
    expect(steerButton).toContain("steerQueuedMessage(index)");
    expect(steerButton).toContain('type="button"');
    expect(prioritizeButton).toContain("<MoveToFrontIcon />");
    expect(prioritizeButton).toContain("moveQueuedMessageToFront");
    expect(prioritizeButton).toContain('type="button"');
    expect(deleteButton).toContain("<TrashIcon />");
    expect(deleteButton).toContain('type="button"');
    expect(editButton).toContain("<EditIcon />");
    expect(editButton).toContain('type="button"');
  });

  it("keeps individual cards visually distinct while the composer stays stacked", () => {
    expect(stylesSource).toMatch(
      /\.queued-message-bar\s*\{[^}]*\bborder-radius:\s*12px 12px 0 0\s*;/gu,
    );
    expect(stylesSource).toMatch(
      /\.queued-message-bar\s*\{[^}]*\bmargin:\s*0 20px -18px\s*;/gu,
    );
    expect(stylesSource).toMatch(
      /\.queued-message-list\s*\{[^}]*\bgap:\s*8px\s*;/gu,
    );
    expect(stylesSource).toMatch(
      /\.queued-message-item\s*\{[^}]*\bborder-radius:\s*9px\s*;/gu,
    );
    expect(stylesSource).toMatch(
      /\.queued-message-actions\s*\{[^}]*\bmargin-left:\s*auto/gu,
    );
    expect(stylesSource).toMatch(
      /\.queued-message-actions button\s*\{[^}]*\bcursor:\s*pointer/gu,
    );
    expect(stylesSource).toMatch(
      /\.queued-message-bar \+ \.composer\s*\{[^}]*\bz-index:\s*1/gu,
    );
  });

  it("localizes queued-message titles and aria labels in English and zh-CN", () => {
    expect(appSource).toContain(
      'queuedMessages: "{{count}} queued after the current task"',
    );
    expect(appSource).toContain('queueSteer: "Steer"');
    expect(appSource).toContain(
      'queueSteerHint: "Steer this queued message into the active task"',
    );
    expect(appSource).toContain('queueMoveToFront: "Move to front"');
    expect(appSource).toContain('queueDelete: "Delete queued message"');
    expect(appSource).toContain('queueEdit: "Edit queued message"');
    expect(appSource).toContain('queueSave: "Save queued message"');
    expect(appSource).toContain(
      'queuedMessages: "当前任务后等待 {{count}} 条"',
    );
    expect(appSource).toContain('queueSteer: "引导"');
    expect(appSource).toContain('queueSteerHint: "将此排队消息引导到当前任务"');
    expect(appSource).toContain('queueMoveToFront: "移到队首"');
    expect(appSource).toContain('queueDelete: "删除排队消息"');
    expect(appSource).toContain('queueEdit: "编辑排队消息"');

    const steerButton = sourceForQueuedButton("queued-message-steer");
    const prioritizeButton = sourceForQueuedButton("queued-message-prioritize");
    const deleteButton = sourceForQueuedButton("queued-message-delete");
    const editButton = sourceForQueuedButton("queued-message-edit");

    expect(steerButton).toContain("aria-label={`${t.queueSteer}:");
    expect(steerButton).toContain("title={t.queueSteerHint}");
    expect(prioritizeButton).toContain("aria-label={`${t.queueMoveToFront}");
    expect(prioritizeButton).toContain("title={t.queueMoveToFrontHint}");
    expect(deleteButton).toContain("aria-label={`${t.queueDelete}");
    expect(deleteButton).toContain("title={t.queueDelete}");
    expect(editButton).toContain("aria-label={`${t.queueEdit}");
    expect(editButton).toContain("title={t.queueEdit}");
  });

  it("queues active-turn submissions as follow-up without the old queue behavior toggle", () => {
    const sendPrompt = sourceForConstant("sendPrompt");

    expect(sendPrompt).toContain("if (activeThread && turnActive)");
    expect(sendPrompt).toContain("window.artemis.followUpTurn({");
    expect(sendPrompt).not.toContain("window.artemis.steerTurn({");
    expect(sendPrompt).not.toContain("queueBehavior");
    expect(appSource).not.toContain('className="queue-behavior"');
    expect(appSource).not.toContain("setQueueBehavior");
  });

  it("steers, edits, deletes, and reprioritizes individual messages", () => {
    const steerQueuedMessage = sourceForConstant("steerQueuedMessage");
    const replaceQueuedMessages = sourceForConstant("replaceQueuedMessages");
    const deleteQueuedMessage = sourceForConstant("deleteQueuedMessage");

    expect(steerQueuedMessage).toContain("window.artemis.steerQueuedTurn({");
    expect(steerQueuedMessage).toContain("followUpIndex: index");
    expect(steerQueuedMessage).toContain(
      "const expectedText = queuedFollowUps[index]",
    );
    expect(steerQueuedMessage).toContain(
      "expectedFollowUp: [...queuedFollowUps]",
    );
    expect(replaceQueuedMessages).toContain("window.artemis.replaceTurnQueue");
    expect(replaceQueuedMessages).toContain("followUp");
    expect(replaceQueuedMessages).not.toContain("clearTurnQueue");
    expect(deleteQueuedMessage).toContain("queuedFollowUps.filter");
    expect(deleteQueuedMessage).toContain("replaceQueuedMessages");
    expect(appSource).toContain("const moveQueuedMessageToFront =");
    expect(appSource).toContain("queuedFollowUps.slice(0, index)");
    expect(appSource).toContain("const saveQueuedMessage =");
    expect(appSource).toContain("queuedFollowUps.map");
    expect(sourceForQueuedButton("queued-message-delete")).toContain(
      "deleteQueuedMessage",
    );
    expect(sourceForQueuedButton("queued-message-edit")).toContain(
      "setEditingQueuedMessage",
    );
  });

  it("keeps only truly steered messages in the conversation timeline", () => {
    expect(appSource).toContain(
      "const queuedFollowUps = threadState?.queue.followUp ?? [];",
    );
    expect(appSource).not.toContain("...(threadState?.queue.steering ?? []),");

    const timelineStart = appSource.indexOf("function Timeline(");
    const timelineSource = appSource.slice(timelineStart);
    expect(timelineSource).toContain(
      "state.queue.steering.map((message, index) => (",
    );
    expect(timelineSource).toContain(
      'className="user-message steering-message"',
    );
    expect(timelineSource).toContain("{message}");
  });

  it("restores terminally unexecuted queue messages to the owning draft once", () => {
    expect(appSource).toContain('event.payload.type === "queue.recovered"');
    expect(appSource).toContain(
      "recoveredQueueEventIds.current.has(event.eventId)",
    );
    expect(appSource).toContain(
      "conversationDraftKey(undefined, event.threadId)",
    );
    expect(appSource).toContain("restoreComposerMessages(");
  });
});
