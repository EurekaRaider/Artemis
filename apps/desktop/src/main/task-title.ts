import type { AgentEvent, AppLocale, Thread } from "@artemis/protocol";

import { I18N_RESOURCES } from "../shared/i18n-resources.js";
import { mainText } from "./i18n.js";

// Persisted default titles from earlier releases must remain recognizable.
const AUTOMATIC_TITLES = new Set([
  "Waiting for task",
  "等待任务内容",
  "等待任務內容",
  "タスクを待機中",
  "작업 대기 중",
  "Esperando una tarea",
  "En attente d’une tâche",
  "Warten auf Aufgabe",
  "Aguardando tarefa",
  "In attesa di un’attività",
  "Ожидание задачи",
  "في انتظار مهمة",
  "कार्य की प्रतीक्षा",
  "Menunggu tugas",
  ...Object.values(I18N_RESOURCES).flatMap(({ main }) => [
    main.newTask,
    main.waitingForTask,
  ]),
]);

const TITLE_LIMIT = 64;

export interface ImTaskTitleContext {
  channel: "slack" | "feishu" | "wecom";
  initialTitle: string;
}

export function formatImTaskTitle(
  channel: ImTaskTitleContext["channel"],
  summary: string,
): string {
  const platform = { slack: "Slack", feishu: "飞书", wecom: "企业微信" }[
    channel
  ];
  return trimToCodePoints(`${platform} · ${summary}`, TITLE_LIMIT);
}

/** A late model response must never undo a manual rename or resurrect a task. */
export class AutomaticTaskTitles {
  private readonly pending = new Map<string, symbol>();

  cancel(threadId: string): void {
    this.pending.delete(threadId);
  }

  async generate(
    thread: Pick<Thread, "id" | "title">,
    generate: () => Promise<string>,
    current: () => Thread | undefined,
    apply: (title: string) => void,
  ): Promise<void> {
    if (this.pending.has(thread.id)) return;
    const token = Symbol();
    this.pending.set(thread.id, token);
    try {
      const title = (await generate()).trim();
      const latest = current();
      if (
        this.pending.get(thread.id) === token &&
        latest &&
        !latest.archived &&
        latest.title === thread.title &&
        title &&
        Array.from(title).length <= TITLE_LIMIT &&
        !/[\r\n\0]/u.test(title)
      )
        apply(title);
    } catch {
      // The immediate, locally derived title remains usable offline or on error.
    } finally {
      if (this.pending.get(thread.id) === token) this.pending.delete(thread.id);
    }
  }
}

function trimToCodePoints(value: string, limit: number): string {
  const points = Array.from(value);
  return points.length <= limit
    ? value
    : `${points
        .slice(0, limit - 1)
        .join("")
        .trimEnd()}…`;
}

export function isAutomaticTaskTitle(title: string): boolean {
  return AUTOMATIC_TITLES.has(title.trim());
}

export function shouldGenerateTaskTitle(
  title: string,
  source: "user" | "goal-continuation",
  events: readonly AgentEvent[],
  initialImTitle?: string,
): boolean {
  return (
    source === "user" &&
    (isAutomaticTaskTitle(title) || title === initialImTitle) &&
    !events.some((event) => event.payload.type === "user.message")
  );
}

export function deriveTaskTitle(request: string, locale: AppLocale): string {
  if (/^\s*\/init\s*$/iu.test(request)) {
    return mainText(locale, "initializeProject");
  }

  const normalized = request
    .replace(/```[\s\S]*?```/gu, " ")
    .replace(/`([^`]+)`/gu, "$1")
    .replace(/https?:\/\/\S+/giu, " ")
    .replace(/^(?:\s*\/skill:[^\s]+\s*)+/giu, "")
    .replace(/^\/goal(?:\s+|$)/iu, "")
    .replace(/\s+/gu, " ")
    .trim();

  if (!normalized) {
    return mainText(locale, "inspectAttachments");
  }

  const firstThought =
    normalized.split(
      /(?:[。！？!?;；]|\.\s+|[，,]\s*(?:并(?:且)?|同时|然后)|,\s*(?:and|then)\s+)/iu,
      1,
    )[0] ?? normalized;
  const withoutBoilerplate = /\p{Script=Han}/u.test(firstThought)
    ? firstThought.replace(
        /^(?:麻烦|请)?(?:帮我|帮忙)?(?:请)?(?:实现|添加|新增|修复|检查|分析|设计|重构|更新|支持)?/u,
        (match) =>
          /(?:实现|添加|新增|修复|检查|分析|设计|重构|更新|支持)/u.test(match)
            ? match.replace(/^(?:麻烦|请)?(?:帮我|帮忙)?(?:请)?/u, "")
            : "",
      )
    : firstThought.replace(
        /^(?:(?:please|kindly)\s+)?(?:(?:can|could|would)\s+you\s+)?(?:help\s+(?:me\s+)?(?:to\s+)?)?/iu,
        "",
      );
  const title = withoutBoilerplate
    .replace(/^[\s:：,，.-]+|[\s:：,，.-]+$/gu, "")
    .trim();
  const displayTitle =
    locale === "en" && /^[a-z]/u.test(title)
      ? `${title[0]!.toUpperCase()}${title.slice(1)}`
      : title;

  return trimToCodePoints(
    displayTitle || mainText(locale, "codingTask"),
    TITLE_LIMIT,
  );
}
