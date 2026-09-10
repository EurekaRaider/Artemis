import { useId, useRef, useState } from "react";
import type { AppLocale } from "@artemis/protocol";
import { Popover } from "@artemis/ui/feedback";
import { ArtemisIcon } from "@artemis/ui/icons";
import { localizedCopy } from "../shared/i18n-resources.js";
import { legacyLocale } from "../shared/locales.js";

const labels = {
  en: {
    title: "Unable to load PR status",
    connection: "GitHub connection interrupted. Try again shortly.",
    fallback: "Could not refresh GitHub status. Retry or view details.",
    retry: "Retry",
    retrying: "Retrying…",
    details: "View details",
    errorDetails: "Error details",
    copy: "Copy details",
    copied: "Copied",
    copyFailed: "Could not copy. Select and copy the details below.",
    close: "Close",
  },
  "zh-CN": {
    title: "暂时无法获取 PR 状态",
    connection: "GitHub 连接中断，请稍后重试。",
    fallback: "未能刷新 GitHub 状态，可重试或查看详情。",
    retry: "重试",
    retrying: "正在重试…",
    details: "查看详情",
    errorDetails: "错误详情",
    copy: "复制详情",
    copied: "已复制",
    copyFailed: "复制失败，请选择下方详情手动复制。",
    close: "关闭",
  },
};

export function EnvironmentPullRequestError({
  error,
  loading,
  locale,
  onRetry,
}: {
  error: string;
  loading: boolean;
  locale: AppLocale;
  onRetry: () => void;
}) {
  const t = localizedCopy(locale, "app", labels[legacyLocale(locale)]);
  const id = useId();
  const anchor = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">(
    "idle",
  );
  const connectionError =
    /\b(?:EOF|ECONNRESET|ETIMEDOUT|ENOTFOUND)\b|connection (?:reset|closed)|network is unreachable/i.test(
      error,
    );

  return (
    <div className="environment-pr-error">
      <ArtemisIcon name="info" className="environment-pr-error-icon" />
      <div>
        <div role="status" aria-live="polite">
          <p>{t.title}</p>
          <small>{connectionError ? t.connection : t.fallback}</small>
        </div>
        <div className="environment-pr-error-actions">
          <button type="button" disabled={loading} onClick={onRetry}>
            {loading ? t.retrying : t.retry}
          </button>
          <button
            type="button"
            ref={anchor}
            aria-expanded={open}
            aria-haspopup="dialog"
            aria-controls={open ? id : undefined}
            onClick={() => {
              setCopyState("idle");
              setOpen(!open);
            }}
          >
            {t.details}
          </button>
        </div>
      </div>
      <Popover
        id={id}
        anchorRef={anchor}
        open={open}
        onOpenChange={setOpen}
        label={t.errorDetails}
        align="end"
        className="environment-pr-error-popover"
      >
        <header>
          <strong>{t.errorDetails}</strong>
          <button
            type="button"
            aria-label={copyState === "copied" ? t.copied : t.copy}
            title={copyState === "copied" ? t.copied : t.copy}
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(error);
                setCopyState("copied");
              } catch {
                setCopyState("failed");
              }
            }}
          >
            {copyState === "copied" ? (
              <ArtemisIcon name="check" />
            ) : (
              <svg
                aria-hidden="true"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
              >
                <rect x="8" y="8" width="12" height="13" rx="2" />
                <path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h3" />
              </svg>
            )}
          </button>
          <button
            type="button"
            aria-label={t.close}
            title={t.close}
            onClick={() => setOpen(false)}
          >
            <ArtemisIcon name="close" />
          </button>
        </header>
        {copyState !== "idle" && (
          <small role="status">
            {copyState === "copied" ? t.copied : t.copyFailed}
          </small>
        )}
        <pre tabIndex={0}>{error}</pre>
      </Popover>
    </div>
  );
}
