const CHILD_AGENT_MARK_COLORS = [
  "#a59be5",
  "#e8b16c",
  "#77acee",
  "#72c4ae",
  "#e69182",
  "#7bbecc",
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
    shape: (hash >>> 8) % 6,
  };
}

// Stable identity marks share one quiet, rounded line style across all surfaces.
const CHILD_AGENT_GLYPHS = [
  <>
    <circle cx="10" cy="6" r="3" />
    <path d="M3.5 17v-1a6.5 6.5 0 0 1 13 0v1Z" />
  </>,
  <>
    <circle cx="8.5" cy="8.5" r="5.5" />
    <path d="m12.5 12.5 4.5 4.5" />
  </>,
  <path d="m7 5-5 5 5 5m6-10 5 5-5 5" />,
  <>
    <path d="M7 2h6M8 2v6l-5 8a1 1 0 0 0 1 1.5h12a1 1 0 0 0 1-1.5l-5-8V2M6 12h8" />
  </>,
  <>
    <circle cx="10" cy="10" r="7.5" />
    <path d="m13.5 6.5-2 5-5 2 2-5Z" />
  </>,
  <>
    <rect x="4" y="2.5" width="12" height="15" rx="2" />
    <path d="M7 7h6M7 11h4" />
  </>,
];

export function ChildAgentIcon({
  className,
  identity = "agent-team",
}: {
  className?: string;
  identity?: string | undefined;
}) {
  const { color, shape } = childAgentMarkForIdentity(identity);
  return (
    <svg
      aria-hidden="true"
      className={["child-agent-mark", className].filter(Boolean).join(" ")}
      focusable="false"
      style={{ color }}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      viewBox="0 0 20 20"
    >
      {CHILD_AGENT_GLYPHS[shape]}
    </svg>
  );
}
