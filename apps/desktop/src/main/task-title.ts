import type { AppLocale } from "@artemis/protocol";

import { I18N_RESOURCES } from "../shared/i18n-resources.js";
import { mainText } from "./i18n.js";

const AUTOMATIC_TITLES = new Set(
  Object.values(I18N_RESOURCES).flatMap(({ main }) => [
    main.newTask,
    main.waitingForTask,
  ]),
);

const TITLE_LIMIT = 64;

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
