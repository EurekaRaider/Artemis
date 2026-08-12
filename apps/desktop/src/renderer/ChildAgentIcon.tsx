const CHILD_AGENT_MARK_COLORS = [
  "#4f86ff",
  "#1fc9ae",
  "#f2a93b",
  "#f2667e",
  "#8cc84b",
  "#ff7652",
  "#35b9db",
  "#b36fea",
  "#e08b3f",
  "#42c98b",
  "#e85db4",
  "#7f7aff",
] as const;

function childAgentMarkHash(identity: string): number {
  let hash = 2_166_136_261;
  for (let index = 0; index < identity.length; index += 1) {
    hash ^= identity.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619) >>> 0;
  }
  return hash;
}

export function childAgentMarkForIdentity(identity: string) {
  const hash = childAgentMarkHash(identity);
  return {
    color: CHILD_AGENT_MARK_COLORS[hash % CHILD_AGENT_MARK_COLORS.length],
    shape: (hash >>> 8) % 8,
  };
}

export function ChildAgentIcon({
  className,
  identity = "agent-team",
}: {
  className?: string;
  identity?: string | undefined;
}) {
  const { color, shape } = childAgentMarkForIdentity(identity);
  const glyph = (() => {
    switch (shape) {
      case 0:
        return (
          <>
            <path
              d="M10 1.5 17.4 5.75v8.5L10 18.5l-7.4-4.25v-8.5Z"
              opacity="0.32"
            />
            <path
              d="M6.4 10h7.2M10 6.4v7.2"
              fill="none"
              stroke="currentColor"
              strokeLinecap="round"
              strokeWidth="1.8"
            />
          </>
        );
      case 1:
        return (
          <>
            <path d="M10 1.35 18.65 10 10 18.65 1.35 10Z" opacity="0.32" />
            <circle cx="10" cy="10" r="2.7" />
            <circle cx="10" cy="5.2" r="0.9" />
            <circle cx="14.8" cy="10" r="0.9" />
          </>
        );
      case 2:
        return (
          <>
            <circle cx="10" cy="10" r="8.35" opacity="0.32" />
            <ellipse
              cx="10"
              cy="10"
              fill="none"
              rx="5.2"
              ry="2.9"
              stroke="currentColor"
              strokeWidth="1.45"
              transform="rotate(-28 10 10)"
            />
            <circle cx="10" cy="10" r="1.8" />
          </>
        );
      case 3:
        return (
          <>
            <path
              d="M10 1.45 17 4.25v5.1c0 4.35-2.75 7.45-7 9.2-4.25-1.75-7-4.85-7-9.2v-5.1Z"
              opacity="0.32"
            />
            <path d="m10.8 4.9-4.1 6h3l-.5 4.2 4.1-6h-3Z" />
          </>
        );
      case 4:
        return (
          <>
            <rect
              height="16.5"
              opacity="0.32"
              rx="4.2"
              width="16.5"
              x="1.75"
              y="1.75"
            />
            <path d="M5.4 5.4h3.2v3.2H5.4zm6 0h3.2v3.2h-3.2zm-6 6h3.2v3.2H5.4zm6 0h3.2v3.2h-3.2z" />
          </>
        );
      case 5:
        return (
          <>
            <path d="M10 1.4 18.65 17H1.35Z" opacity="0.32" />
            <path
              d="m10 6.15 4.05 7.1h-8.1Z"
              fill="none"
              stroke="currentColor"
              strokeLinejoin="round"
              strokeWidth="1.65"
            />
          </>
        );
      case 6:
        return (
          <>
            <rect height="17" opacity="0.32" rx="6" width="12" x="4" y="1.5" />
            <path
              d="M7.05 7.1c1.55-2.05 4.35-2.05 5.9 0M7.05 12.9c1.55 2.05 4.35 2.05 5.9 0"
              fill="none"
              stroke="currentColor"
              strokeLinecap="round"
              strokeWidth="1.7"
            />
            <circle cx="10" cy="10" r="1.45" />
          </>
        );
      default:
        return (
          <>
            <path
              d="m10 1.35 2.1 3.15 3.7-.3-.3 3.7L18.65 10l-3.15 2.1.3 3.7-3.7-.3L10 18.65 7.9 15.5l-3.7.3.3-3.7L1.35 10 4.5 7.9l-.3-3.7 3.7.3Z"
              opacity="0.32"
            />
            <circle
              cx="10"
              cy="10"
              fill="none"
              r="3.25"
              stroke="currentColor"
              strokeWidth="1.45"
            />
            <circle cx="10" cy="10" r="1.15" />
          </>
        );
    }
  })();

  return (
    <svg
      aria-hidden="true"
      className={["child-agent-mark", className].filter(Boolean).join(" ")}
      focusable="false"
      style={{ color }}
      viewBox="0 0 20 20"
    >
      {glyph}
    </svg>
  );
}
