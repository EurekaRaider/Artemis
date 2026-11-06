import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { type ImStatus } from "@artemis/protocol";

export type Status = ImStatus & { connections?: unknown[]; spaces?: unknown[] };

export type BotMetadata = Partial<
  Record<(typeof PUBLIC_BOT_FIELDS)[number], string>
>;

export const PUBLIC_BOT_FIELDS = [
  "id",
  "name",
  "tenantId",
  "botId",
  "appId",
  "botOpenId",
  "transport",
  "domain",
] as const;

export function ImMarqueeText({ text }: { text: string }) {
  const outer = useRef<HTMLSpanElement>(null);
  const copy = useRef<HTMLSpanElement>(null);
  const [overflow, setOverflow] = useState(false);
  const [playing, setPlaying] = useState(false);
  useEffect(() => {
    const outerEl = outer.current;
    const copyEl = copy.current;
    if (!outerEl || !copyEl) return;
    const check = () => setOverflow(copyEl.scrollWidth > outerEl.clientWidth);
    check();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(check);
    observer.observe(outerEl);
    return () => observer.disconnect();
  }, [text]);
  /* 悬停起跑：位移一份拷贝宽度+间距，循环即无缝；速度固定 30px/s。 */
  const distance = (copy.current?.scrollWidth ?? 0) + 24;
  return (
    <span
      ref={outer}
      className="im-marquee"
      data-playing={playing || undefined}
      onMouseEnter={() => {
        if (overflow) setPlaying(true);
      }}
      onMouseLeave={() => setPlaying(false)}
    >
      <span
        className="im-marquee-track"
        style={
          playing
            ? ({
                "--mq-shift": `${-distance}px`,
                "--mq-dur": `${distance / 30}s`,
              } as CSSProperties)
            : undefined
        }
      >
        <span ref={copy} className="im-marquee-copy">
          {text}
        </span>
        {playing && (
          <span className="im-marquee-copy" aria-hidden="true">
            {text}
          </span>
        )}
      </span>
    </span>
  );
}
