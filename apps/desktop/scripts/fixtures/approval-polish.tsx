import React from "react";
import { createRoot } from "react-dom/client";
import { createThreadViewState } from "@artemis/protocol";
import { Timeline, UserInputCard } from "../../src/renderer/App";
import { MultiQuestionUserInputCard } from "../../src/renderer/MultiQuestionUserInputCard";
import { i18n } from "../../src/renderer/i18n";
import "@artemis/ui/styles.css";
import "../../src/renderer/styles.css";
import "../../src/renderer/prototype-migration.css";
import "@artemis/theme-artemis/theme.css";

void i18n.changeLanguage("zh-CN");
const theme = new URLSearchParams(location.search).get("theme") ?? "light";
Object.assign(document.documentElement.dataset, {
  theme,
  artemisSkin: "com.artemis.default",
  artemisTheme: theme,
  artemisContrast: "normal",
});
document.documentElement.lang = "zh-CN";
const events: unknown[][] = [];
Object.assign(window, { previewEvents: events });
const record = (...args: unknown[]) => {
  events.push(args);
};
const state = createThreadViewState("preview");
state.order = ["approval:preview"];
state.approvals.preview = {
  type: "approval.requested",
  approvalId: "preview",
  nonce: "preview-nonce-0001",
  summary: "运行 Shell 命令",
  command: 'sudo -n true 2>&1; echo "sudo 探测命令退出码: $?"',
  paths: [],
  network: [],
  risk: "high",
  allowedScopes: new URLSearchParams(location.search).has("restricted")
    ? ["once"]
    : ["once", "project"],
  modelRecommendation: "deny",
  modelReason: "sudo 涉及特权提权，且此命令尚未获得明确授权。",
  status: "pending",
  requestedAt: new Date().toISOString(),
};
const denied = {
  ...state,
  approvals: {
    preview: { ...state.approvals.preview, status: "denied" as const },
  },
};
const props = {
  installedPlugins: [],
  installedSkills: [],
  locale: "zh-CN" as const,
  onExternalLink: record,
  onFileLink: record,
  onFileLinkContextMenu: record,
  onOpenChildAgent: record,
  onOpenTurnReview: record,
  onCopyText: async () => {},
  onEditUserMessage: undefined,
  onResolve: record,
  onResolveUserInput: async (r: unknown) => record(r),
  onUndoTurnChanges: record,
};
const options = [
  {
    label: "仅检查当前状态",
    description: "查看结果，不执行修改。",
    recommended: true,
  },
  {
    label: "执行并验证",
    description: "完成操作后检查结果。",
    recommended: false,
  },
  { label: "暂不执行", description: "", recommended: false },
];
const input = {
  type: "user-input.requested" as const,
  requestId: "choice",
  nonce: "choice-nonce-0001",
  header: "选择执行方式",
  question: "接下来希望如何处理？",
  options,
  expiresAt: new Date(Date.now() + 300000).toISOString(),
  status: "pending" as const,
};
const multi = {
  ...input,
  kind: "multi-question" as const,
  requestId: "multi",
  questions: [
    {
      questionId: "q1",
      question: input.question,
      options,
      expiresAt: input.expiresAt,
    },
    {
      questionId: "q2",
      question: "继续检查哪些内容？",
      options: options.slice(0, 2),
      expiresAt: input.expiresAt,
    },
  ],
  answers: {
    q1: { status: "pending" as const },
    q2: { status: "pending" as const },
  },
};
createRoot(document.getElementById("root")!).render(
  <main className="polish-preview">
    <section id="expanded">
      <h2>审批 · 展开</h2>
      <Timeline {...props} state={state} />
    </section>
    <section id="collapsed">
      <h2>审批 · 收起</h2>
      <Timeline {...props} state={denied} />
    </section>
    <section id="choice">
      <h2>选择菜单</h2>
      <UserInputCard
        input={input}
        active
        locale="zh-CN"
        onResolve={async (r) => record(r)}
      />
    </section>
    <section id="multi">
      <h2>多题选择</h2>
      <MultiQuestionUserInputCard
        input={multi}
        active
        locale="zh-CN"
        onResolve={async (r) => record(r)}
      />
    </section>
  </main>,
);
