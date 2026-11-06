import { Tooltip } from "@artemis/ui/feedback";
import { ArtemisIcon } from "@artemis/ui/icons";
import { uiText } from "../../shared/i18n/ui-text.js";
import {
  type AnimationEvent as ReactAnimationEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";

import feishuChannelIcon from "../assets/feishu-channel.png";
import slackChannelIcon from "../assets/slack-channel.svg";
import { type AppLocale, type ThreadViewState } from "@artemis/protocol";
import {
  promptWithoutSelectedSkills,
  selectedSkillNamesForPrompt,
} from "../plugins/skill-commands.js";
import { appCopy } from "./app-copy.js";
import { type Locale } from "./app-types.js";
export function statusLabel(
  state: ThreadViewState | undefined,
  locale: Locale,
  clockMs: number,
) {
  const t = appCopy(locale);
  switch (state?.status) {
    case "running": {
      const activity = state.activity;
      if (activity?.phase === "reconnecting") {
        if (activity.kind === "process-restart") return t.hostRecovering;
        const scheduledAt = activity.scheduledAt
          ? Date.parse(activity.scheduledAt)
          : clockMs;
        const seconds = Math.max(
          0,
          Math.ceil((scheduledAt + (activity.delayMs ?? 0) - clockMs) / 1_000),
        );
        if (activity.kind === "rate-limit") {
          return t.rateLimited.replace("{{seconds}}", String(seconds));
        }
        if (activity.maxAttempts === undefined) {
          return t.waitingNetwork.replace("{{seconds}}", String(seconds));
        }
        return (
          activity.kind === "stream-stalled" ? t.modelRetrying : t.reconnecting
        )
          .replace("{{attempt}}", String(activity.attempt ?? 1))
          .replace("{{maximum}}", String(activity.maxAttempts))
          .replace("{{seconds}}", String(seconds));
      }
      if (activity?.phase === "recovered")
        return activity.kind === "process-restart"
          ? t.hostRecovering
          : t.connectionRecovered;
      if (activity?.phase === "interrupted") return t.taskInterrupted;
      return activity?.phase === "queued"
        ? t.queuedForAgent
        : activity?.phase === "requesting-model"
          ? t.waitingForModel
          : t.running;
    }
    case "waiting-approval":
      return t.waiting;
    case "waiting-user-input":
      return t.waitingInput;
    case "failed":
      return t.failed;
    default:
      return t.ready;
  }
}

export function visibleThreadTitle(title: string): string {
  return (
    promptWithoutSelectedSkills(title) ||
    selectedSkillNamesForPrompt(title).join(", ") ||
    title
  );
}

export const IM_TITLE_CHANNELS: Record<string, string> = {
  Slack: "slack",
  飞书: "feishu",
  企业微信: "wecom",
  Lark: "feishu",
};

export function splitImChannelPrefix(
  title: string,
): { channel: string; rest: string } | undefined {
  const match = new RegExp(
    `^(${Object.keys(IM_TITLE_CHANNELS).join("|")})\\s*·\\s*`,
    "u",
  ).exec(title);
  const matched = match?.[1];
  if (!matched) return undefined;
  return {
    channel: IM_TITLE_CHANNELS[matched]!,
    rest: title.slice(match[0].length),
  };
}

export function imChannelDisplayName(channel: string, locale: AppLocale) {
  return channel === "slack"
    ? "Slack"
    : channel === "feishu" || channel === "lark"
      ? uiText(locale, "ImNavigation.message1")
      : channel === "wecom"
        ? uiText(locale, "ImNavigation.message2")
        : "IM";
}

export function ThreadChannelMark({
  channel,
  locale,
}: {
  channel: string;
  locale: AppLocale;
}) {
  /* 第二个图标悬浮气泡：渠道名称。 */
  const label = imChannelDisplayName(channel, locale);
  return (
    <Tooltip label={label}>
      {channel === "feishu" || channel === "lark" ? (
        <img
          alt=""
          aria-hidden="true"
          className="thread-channel-logo"
          src={feishuChannelIcon}
        />
      ) : channel === "slack" ? (
        <img
          alt=""
          aria-hidden="true"
          className="thread-channel-logo"
          src={slackChannelIcon}
        />
      ) : (
        <ArtemisIcon
          aria-hidden="true"
          className="thread-channel-logo"
          name="wecom"
        />
      )}
    </Tooltip>
  );
}

export function ThreadTitleContent({
  title,
  locale,
  hideChannel = false,
}: {
  title: string;
  locale: AppLocale;
  hideChannel?: boolean;
}) {
  const visible = visibleThreadTitle(title);
  const parsed = splitImChannelPrefix(visible);
  const text = parsed ? parsed.rest : visible;
  return (
    <>
      {parsed && !hideChannel && (
        <ThreadChannelMark channel={parsed.channel} locale={locale} />
      )}
      <span className="thread-title-text">
        <span>{text}</span>
        <span aria-hidden="true" className="thread-title-copy">
          {text}
        </span>
      </span>
    </>
  );
}

export function prepareThreadTitleScroll(
  event: ReactPointerEvent<HTMLSpanElement>,
): void {
  const viewport = event.currentTarget;
  const content = viewport.firstElementChild;
  if (!(content instanceof HTMLElement)) return;

  const titleWidth =
    content.firstElementChild instanceof HTMLElement
      ? content.firstElementChild.getBoundingClientRect().width
      : content.scrollWidth;
  const distance = Math.ceil(titleWidth - viewport.clientWidth);
  if (distance <= 1) {
    delete viewport.dataset.overflowing;
    viewport.style.removeProperty("--thread-title-scroll-distance");
    viewport.style.removeProperty("--thread-title-scroll-duration");
    return;
  }

  viewport.dataset.overflowing = "true";
  viewport.style.setProperty(
    "--thread-title-scroll-distance",
    `${document.documentElement.dir === "rtl" ? "" : "-"}${titleWidth + 24}px`,
  );
  viewport.style.setProperty(
    "--thread-title-scroll-duration",
    `${Math.max(4, (titleWidth + 24) / 30).toFixed(2)}s`,
  );
}

export function synchronizeTurnIndicator(
  event: ReactAnimationEvent<HTMLElement>,
) {
  if (event.animationName !== "turn-indicator-breathe") return;
  // A shared document-timeline origin keeps separately mounted indicators in phase.
  for (const animation of (event.target as HTMLElement).getAnimations()) {
    if (
      animation instanceof CSSAnimation &&
      animation.animationName === event.animationName
    )
      animation.startTime = 0;
  }
}
