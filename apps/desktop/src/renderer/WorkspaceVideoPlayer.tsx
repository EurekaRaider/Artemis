import { useEffect, useRef, useState } from "react";
import type { AppLocale } from "@artemis/protocol";
import { Button } from "@artemis/ui/actions";
import type { WorkspaceVideoSource } from "../shared/workspace-video.js";
import { uiText } from "../shared/ui-text.js";
import "./workspace-video.css";

export function WorkspaceVideoPlayer({
  threadId,
  href,
  locale = "en",
}: {
  threadId: string;
  href: string;
  locale?: AppLocale;
}) {
  const root = useRef<HTMLSpanElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const [source, setSource] = useState<WorkspaceVideoSource>();
  const [error, setError] = useState<"unavailable" | "decode">();
  const [attempt, setAttempt] = useState(0);
  const [visible, setVisible] = useState(
    typeof IntersectionObserver === "undefined",
  );

  useEffect(() => {
    const player = video.current;
    const container = root.current;
    const pause = () => {
      if (player && !player.paused) player.pause();
    };
    const onVisibility = () => {
      if (document.hidden) pause();
    };
    document.addEventListener("visibilitychange", onVisibility);
    const observer =
      typeof IntersectionObserver === "undefined"
        ? undefined
        : new IntersectionObserver(([entry]) => {
            if (entry?.isIntersecting) setVisible(true);
            else pause();
          });
    if (container) observer?.observe(container);
    return () => {
      observer?.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      pause();
    };
  }, []);

  useEffect(() => {
    if (!visible) return;
    let active = true;
    let lease: WorkspaceVideoSource | undefined;
    const player = video.current;
    const release = (value: WorkspaceVideoSource) => {
      void window.artemis
        .releaseWorkspaceVideo(threadId, value.url)
        .catch(() => {});
    };
    setSource(undefined);
    setError(undefined);
    void window.artemis
      .openWorkspaceVideo(threadId, href)
      .then((value) => {
        if (!active) {
          release(value);
          return;
        }
        lease = value;
        setSource(value);
      })
      .catch(() => {
        if (active) setError("unavailable");
      });
    return () => {
      active = false;
      if (player?.hasAttribute("src")) {
        if (!player.paused) player.pause();
        player.removeAttribute("src");
        player.load();
      }
      if (lease) release(lease);
    };
  }, [threadId, href, attempt, visible]);

  return (
    <span className="workspace-video-player" ref={root}>
      <video
        aria-label={source?.path ?? href}
        controls
        playsInline
        preload="metadata"
        data-workspace-video-player=""
        ref={video}
        src={source?.url}
        onPlay={(event) => {
          for (const other of document.querySelectorAll<HTMLVideoElement>(
            "video[data-workspace-video-player]",
          ))
            if (other !== event.currentTarget && !other.paused) other.pause();
        }}
        onError={() => {
          if (source)
            setError(
              video.current?.error?.code === 3 ||
                video.current?.error?.code === 4
                ? "decode"
                : "unavailable",
            );
        }}
      />
      {error ? (
        <span className="workspace-video-status" role="alert">
          {uiText(
            locale,
            error === "decode" ? "Video.decodeFailed" : "Video.unavailable",
          )}
          <Button
            variant="quiet"
            onClick={() => setAttempt((value) => value + 1)}
          >
            {uiText(locale, "Video.retry")}
          </Button>
        </span>
      ) : !source ? (
        <span className="workspace-video-status" role="status">
          {uiText(locale, "Video.loading")}
        </span>
      ) : null}
    </span>
  );
}
