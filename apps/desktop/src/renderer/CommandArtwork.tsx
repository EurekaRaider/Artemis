import { useId } from "react";
import { ResourceArtwork } from "./resource-icons.js";

export function CommandArtwork({
  command,
}: {
  command: "goal" | "compact" | "init" | "plan" | "execute" | "review";
}) {
  const gradientId = useId();
  const sharedIcon =
    command === "plan"
      ? "checklist"
      : command === "execute"
        ? "lightning"
        : command === "review"
          ? "file-search"
          : undefined;
  return (
    <span className="resource-avatar" aria-hidden="true">
      {sharedIcon ? (
        <ResourceArtwork icon={sharedIcon} />
      ) : (
        <svg className="resource-artwork" viewBox="0 0 64 64" fill="none">
          <defs>
            <linearGradient id={gradientId} x2=".8" y2="1">
              <stop
                stopColor={
                  command === "goal"
                    ? "#ffb38b"
                    : command === "compact"
                      ? "#c4acff"
                      : "#f5fbff"
                }
              />
              <stop
                offset="1"
                stopColor={
                  command === "goal"
                    ? "#ed624c"
                    : command === "compact"
                      ? "#8661dc"
                      : "#cbe6ff"
                }
              />
            </linearGradient>
          </defs>
          {command === "goal" ? (
            <>
              <circle cx="30" cy="34" r="24" fill={`url(#${gradientId})`} />
              <circle cx="30" cy="34" r="16" fill="#fff1de" />
              <circle cx="30" cy="34" r="9" fill="#f27659" />
              <path
                d="m30 34 20-20"
                stroke="#566b9b"
                strokeWidth="4"
                strokeLinecap="round"
              />
              <path d="m44 9 1 10 10 1 5-6-10-1-1-10Z" fill="#8db9ef" />
            </>
          ) : command === "compact" ? (
            <>
              <rect
                x="13"
                y="18"
                width="38"
                height="30"
                rx="6"
                fill="#7150bd"
              />
              <rect
                x="9"
                y="13"
                width="38"
                height="30"
                rx="6"
                fill={`url(#${gradientId})`}
              />
              <path
                d="M19 24h17M19 32h11"
                stroke="#eee5ff"
                strokeWidth="3"
                strokeLinecap="round"
              />
              <path
                d="m7 52 10-10m-9 0h9v9M57 7 47 17m0-9v9h9"
                stroke="#d6baff"
                strokeWidth="4"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </>
          ) : (
            <>
              <rect
                x="10"
                y="10"
                width="37"
                height="46"
                rx="6"
                fill="#388de2"
                transform="rotate(-7 28 33)"
              />
              <path
                d="M20 5h22l12 12v35a5 5 0 0 1-5 5H20a5 5 0 0 1-5-5V10a5 5 0 0 1 5-5"
                fill={`url(#${gradientId})`}
              />
              <path d="M42 5v9a3 3 0 0 0 3 3h9" fill="#8fc7f5" />
              <path
                d="M24 26h19M24 34h12"
                stroke="#6ba4d6"
                strokeWidth="3"
                strokeLinecap="round"
              />
              <circle cx="46" cy="47" r="12" fill="#49bb97" />
              <path
                d="M46 41v12m-6-6h12"
                stroke="#edfff5"
                strokeWidth="3"
                strokeLinecap="round"
              />
            </>
          )}
        </svg>
      )}
    </span>
  );
}
