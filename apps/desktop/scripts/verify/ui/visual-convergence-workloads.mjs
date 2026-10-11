const workloads = [
  { id: "screenshot-matrix", script: "capture-screenshot-matrix.mjs" },
  { id: "conversation-timeline", script: "verify-conversation-timeline.mjs" },
  { id: "feedback-and-composer", script: "verify-feedback-layout.mjs" },
  {
    id: "large-diff-and-environment",
    script: "verify-environment-panel-responsive.mjs",
  },
  { id: "terminal-and-browser", script: "verify-workspace-dock.mjs" },
  { id: "form-controls", script: "verify-form-controls.mjs" },
  { id: "navigation-controls", script: "verify-navigation-controls.mjs" },
  { id: "resource-center-mcp", script: "verify-mcp-editor.mjs" },
  { id: "secondary-pages", script: "verify-secondary-pages.mjs" },
  { id: "goal-parity", script: "verify-goal-parity-shards.mjs" },
];

// Balance the measured macOS workloads across separate runners. Each runner
// stays serial so native windows and exclusive focus probes cannot interfere.
const macosShards = [
  [
    "screenshot-matrix",
    "conversation-timeline",
    "large-diff-and-environment",
    "resource-center-mcp",
  ],
  [
    "feedback-and-composer",
    "terminal-and-browser",
    "navigation-controls",
    "goal-parity",
  ],
  ["form-controls", "secondary-pages", "desktop-skin-gallery-package"],
];

export function selectVisualConvergenceWorkloads(platform, shardArgument) {
  const available = [
    ...workloads,
    ...(platform === "darwin"
      ? [
          {
            id: "desktop-skin-gallery-package",
            script: "verify-desktop-skin.mjs",
          },
        ]
      : []),
  ].map((workload) => ({ ...workload, budget: workload.id }));
  if (shardArgument === undefined) return { workloads: available };

  const match = /^--shard=([1-3])\/3$/u.exec(shardArgument);
  if (platform !== "darwin" || !match) {
    throw new Error("Visual shards require macOS and --shard=1/3, 2/3 or 3/3.");
  }
  const index = Number(match[1]);
  const selected = macosShards[index - 1];
  return {
    workloads: available.filter((workload) => selected.includes(workload.id)),
    shard: {
      index,
      count: macosShards.length,
      totalWorkloads: available.length,
    },
  };
}
