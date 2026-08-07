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
  it("renders the queued-message bar immediately above the input with steer delete edit controls", () => {
    const barIndex = appSource.indexOf('className="queued-message-bar"');
    const textareaIndex = appSource.indexOf("<textarea", barIndex);
    const barSource = appSource.slice(barIndex, textareaIndex);
    const steerIndex = barSource.indexOf('className="queued-message-steer"');
    const deleteIndex = barSource.indexOf('className="queued-message-delete"');
    const editIndex = barSource.indexOf('className="queued-message-edit"');

    expect(barIndex).toBeGreaterThan(-1);
    expect(textareaIndex).toBeGreaterThan(barIndex);
    expect(barSource).toContain("{queuedMessage");
    expect(barSource).toContain('className="queued-message-actions"');
    expect(steerIndex).toBeGreaterThan(-1);
    expect(deleteIndex).toBeGreaterThan(steerIndex);
    expect(editIndex).toBeGreaterThan(deleteIndex);

    const steerButton = sourceForQueuedButton("queued-message-steer");
    const deleteButton = sourceForQueuedButton("queued-message-delete");
    const editButton = sourceForQueuedButton("queued-message-edit");

    expect(steerButton).toContain("<SteerIcon />");
    expect(steerButton).toContain("{t.queueSteer}");
    expect(steerButton).toContain('type="button"');
    expect(deleteButton).toContain("<TrashIcon />");
    expect(deleteButton).toContain('type="button"');
    expect(editButton).toContain("<EllipsisIcon />");
    expect(editButton).toContain('type="button"');
    expect(stylesSource).toMatch(
      /\.queued-message-bar\s*\{[^}]*\bdisplay:\s*flex/gu,
    );
    expect(stylesSource).toMatch(
      /\.queued-message-actions\s*\{[^}]*\bmargin-left:\s*auto/gu,
    );
    expect(stylesSource).toMatch(
      /\.queued-message-actions button\s*\{[^}]*\bcursor:\s*pointer/gu,
    );
  });

  it("keeps stacked composer edges continuous and hides the upper border behind the rounded composer", () => {
    expect(stylesSource).toMatch(
      /\.queued-message-bar\s*\{[^}]*\bborder-radius:\s*0\s*;/gu,
    );
    expect(stylesSource).toMatch(
      /\.queued-message-bar\s*\{[^}]*\bmargin:\s*0 20px -18px\s*;/gu,
    );
    expect(stylesSource).toMatch(
      /\.queued-message-bar\s*\{[^}]*\bmin-height:\s*58px\s*;/gu,
    );
    expect(stylesSource).toMatch(
      /\.queued-message-bar\s*\{[^}]*\bpadding:\s*0 12px 18px\s*;/gu,
    );
    expect(stylesSource).toMatch(
      /\.queued-message-bar \+ \.composer\s*\{[^}]*\bz-index:\s*1/gu,
    );
  });

  it("localizes queued-message titles and aria labels in English and zh-CN", () => {
    expect(appSource).toContain('queueSteer: "Steer"');
    expect(appSource).toContain(
      'queueSteerHint: "Steer this queued message into the active turn"',
    );
    expect(appSource).toContain('queueDelete: "Delete queued message"');
    expect(appSource).toContain('queueEdit: "Edit queued message"');
    expect(appSource).toContain('queueSteer: "引导"');
    expect(appSource).toContain('queueSteerHint: "将此排队消息引导到当前执行"');
    expect(appSource).toContain('queueDelete: "删除排队消息"');
    expect(appSource).toContain('queueEdit: "编辑排队消息"');

    const steerButton = sourceForQueuedButton("queued-message-steer");
    const deleteButton = sourceForQueuedButton("queued-message-delete");
    const editButton = sourceForQueuedButton("queued-message-edit");

    expect(steerButton).toContain("aria-label={t.queueSteerHint}");
    expect(steerButton).toContain("title={t.queueSteerHint}");
    expect(deleteButton).toContain("aria-label={t.queueDelete}");
    expect(deleteButton).toContain("title={t.queueDelete}");
    expect(editButton).toContain("aria-label={t.queueEdit}");
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

  it("deletes, edits, and atomically steers the queued message through queue IPC", () => {
    const deleteQueuedMessage = sourceForConstant("deleteQueuedMessage");
    const editQueuedMessage = sourceForConstant("editQueuedMessage");
    const steerQueuedMessage = sourceForConstant("steerQueuedMessage");

    expect(deleteQueuedMessage).toContain(
      "await window.artemis.clearTurnQueue(activeThread.id)",
    );
    expect(deleteQueuedMessage).not.toContain("setPrompt(");

    expect(editQueuedMessage).toMatch(
      /const\s+queue\s*=\s*await\s+window\.artemis\.clearTurnQueue\(activeThread\.id\)/u,
    );
    expect(editQueuedMessage).toMatch(
      /setPrompt\([\s\S]*(?:queue\.followUp|queue\.steering)/u,
    );

    expect(steerQueuedMessage).toContain(
      "await window.artemis.steerTurnQueue(activeThread.id)",
    );
    expect(steerQueuedMessage).not.toContain("clearTurnQueue");

    expect(sourceForQueuedButton("queued-message-steer")).toContain(
      "steerQueuedMessage",
    );
    expect(appSource).toContain(
      "const canSteerQueuedMessage = (threadState?.queue.followUp.length ?? 0) > 0;",
    );
    expect(appSource).toMatch(
      /\{canSteerQueuedMessage && \(\s*<button[\s\S]*?className="queued-message-steer"/u,
    );
    expect(sourceForQueuedButton("queued-message-delete")).toContain(
      "deleteQueuedMessage",
    );
    expect(sourceForQueuedButton("queued-message-edit")).toContain(
      "editQueuedMessage",
    );
  });

  it("moves steered messages into the conversation and removes the entire follow-up bar", () => {
    expect(appSource).toContain(
      'const queuedMessage = (threadState?.queue.followUp ?? []).join("\\n\\n");',
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
