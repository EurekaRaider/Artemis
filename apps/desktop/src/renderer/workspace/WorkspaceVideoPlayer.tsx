import { useEffect, useRef, useState } from "react";
import type { AppLocale } from "@artemis/protocol";
import { Button } from "@artemis/ui/actions";
import {
  workspaceAudioMimeType,
  type WorkspaceVideoSource,
} from "../../shared/workspace-video.js";
import { timelinePreviewCopy } from "../conversation/timeline-preview-copy.js";
import { uiText } from "../../shared/i18n/ui-text.js";
import "./workspace-video.css";

export function WorkspaceVideoPlayer({
  threadId,
  href,
  locale = "en",
  onOpen,
}: {
  threadId: string;
  href: string;
  locale?: AppLocale;
  onOpen?: ((path: string) => void) | undefined;
}) {
  const root = useRef<HTMLSpanElement>(null);
  const video = useRef<HTMLMediaElement>(null);
  const audio = Boolean(workspaceAudioMimeType(href));
  const Media = audio ? "audio" : "video";
  const copy = timelinePreviewCopy(locale);
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
      <Media
        aria-label={source?.path ?? href}
        controls
        playsInline
        preload="metadata"
        data-workspace-video-player=""
        ref={(element) => {
          video.current = element;
        }}
        src={source?.url}
        onPlay={(event) => {
          for (const other of document.querySelectorAll<HTMLMediaElement>(
            "video[data-workspace-video-player],audio[data-workspace-video-player]",
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
          {audio
            ? copy.audioFailed
            : uiText(
                locale,
                error === "decode" ? "Video.decodeFailed" : "Video.unavailable",
              )}
          <Button
            variant="quiet"
            onClick={() => setAttempt((value) => value + 1)}
          >
            {uiText(locale, "Video.retry")}
          </Button>
          {onOpen && (
            <Button variant="quiet" onClick={() => onOpen(href)}>
              {copy.open}
            </Button>
          )}
        </span>
      ) : !source ? (
        <span className="workspace-video-status" role="status">
          {audio ? copy.loading : uiText(locale, "Video.loading")}
        </span>
      ) : null}
    </span>
  );
}
