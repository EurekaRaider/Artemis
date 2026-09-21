import type { AppLocale } from "@artemis/protocol";
import { imText, type ImMessageKey } from "./im-localization.js";
import {
  decodeNativeEnvelope,
  encodeNativeEnvelope,
  type NativeEnvelope,
} from "./native-protocol.js";

const labels: Record<NativeEnvelope["action"], ImMessageKey> = {
  hello: "nativeHello",
  probe: "nativeProbe",
  proof: "nativeProof",
  delegate: "nativeDelegate",
  continue: "nativeContinue",
  accepted: "accepted",
  note: "nativeNote",
  progress: "nativeProgress",
  heartbeat: "heartbeat",
  completed: "nativeCompleted",
  failed: "nativeFailed",
  rejected: "nativeRejected",
  cancel: "nativeCancel",
  cancelled: "nativeCancelled",
};

/** A post renders the status and task text; the protocol travels in a link
 * fragment, which browsers do not send to the destination server. The link
 * itself opens this same chat, never an external protocol collector. */
export function feishuNativePost(
  text: string,
  recipient: string,
  locale?: AppLocale,
) {
  const frame = decodeNativeEnvelope(text);
  if (
    !frame ||
    frame.recipient !== recipient ||
    !["feishu", "lark"].includes(frame.platform)
  )
    throw new Error("Invalid native collaboration message.");
  const url = new URL(
    `https://applink.${frame.platform === "lark" ? "larksuite.com" : "feishu.cn"}/client/chat/open`,
  );
  url.searchParams.set("openChatId", frame.group);
  url.hash = text;
  return {
    zh_cn: {
      title: "",
      content: [
        [
          ...(recipient === "*" ? [] : [{ tag: "at", user_id: recipient }]),
          {
            tag: "a",
            text: imText(locale ?? frame.locale, labels[frame.action]),
            href: url.href,
          },
        ],
        ...(["hello", "probe", "proof"].includes(frame.action) || !frame.text
          ? []
          : [[{ tag: "text", text: frame.text }]]),
      ],
    },
  };
}

export function feishuNativeLink(
  href: string,
  group: string,
  domain: "feishu" | "lark",
): string | undefined {
  try {
    const url = new URL(href);
    if (
      url.origin !==
        `https://applink.${domain === "lark" ? "larksuite.com" : "feishu.cn"}` ||
      url.pathname !== "/client/chat/open" ||
      url.searchParams.get("openChatId") !== group
    )
      return undefined;
    const text = decodeURIComponent(url.hash.slice(1));
    const frame = decodeNativeEnvelope(text);
    return frame?.group === group && frame.platform === domain
      ? text
      : undefined;
  } catch {
    return undefined;
  }
}

/** Identity comes from the authenticated platform event, not from the peer's
 * app-scoped Open IDs. A targeted frame must actually mention this bot. Native
 * cooperation still checks tenant/group, permissions and correlated proofs. */
export function localizeFeishuNative(
  text: string,
  sender: string,
  mentioned: boolean,
  config: { botOpenId: string },
): string | undefined {
  const frame = decodeNativeEnvelope(text);
  if (
    !sender ||
    sender.length > 256 ||
    !frame ||
    (frame.recipient !== "*" && !mentioned)
  )
    return undefined;
  try {
    return encodeNativeEnvelope({
      ...frame,
      sender,
      recipient: frame.recipient === "*" ? "*" : config.botOpenId,
      ...(frame.ancestors
        ? {
            ancestors: frame.ancestors.map((ancestor) => ({
              ...ancestor,
              sender:
                ancestor.sender === frame.recipient
                  ? config.botOpenId
                  : ancestor.sender,
            })),
          }
        : {}),
    });
  } catch {
    // Local IDs can be longer than the wire IDs; preserve the protocol size
    // bound without turning a malformed event into an endless platform retry.
    return undefined;
  }
}
