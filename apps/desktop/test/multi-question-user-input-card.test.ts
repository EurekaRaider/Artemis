//
// D#76 PR10C §5 red suite (decision L option 1): the renderer must gain a
// dedicated multi-question card component, and App.tsx must only wire the
// kind-discriminated mount point (no business logic in App). Source-level
// probes follow the repo convention (input-fields.test.tsx,
// renderer-layout.test.ts, icon-sizing.test.ts): today App.tsx has zero
// "multi-question"/"MultiQuestion" occurrences, so multi-question inputs
// render only through the PR10A legacy single-question projection. The
// behavioral DOM matrix (dots tablist, roving tabindex, per-question
// countdown, drafts, dedupe) lands in this same PR together with the
// component; this file goes red first and stays as the mount-point guard.
//
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const rendererDir = resolve(process.cwd(), "src/renderer");
const componentPath = resolve(rendererDir, "MultiQuestionUserInputCard.tsx");
const appSource = readFileSync(resolve(rendererDir, "App.tsx"), "utf8");

describe("multi-question card mount point (D#76 PR10C, decision L option 1)", () => {
  it("ships a dedicated multi-question card component in the renderer local directory", () => {
    expect(
      existsSync(componentPath),
      `renderer 应包含多题卡组件 src/renderer/MultiQuestionUserInputCard.tsx（决策点 L 案 1）：当前缺失——多题输入仍以 legacy 单题投影渲染（App.tsx 全文零 "multi-question"/"MultiQuestion" 命中）`,
    ).toBe(true);
  });

  it("wires App.tsx to the multi-question card component (wiring only)", () => {
    expect(
      appSource.includes("MultiQuestionUserInputCard"),
      "App.tsx 应按输入 kind 判别把多题输入接线到 MultiQuestionUserInputCard（仅 wiring，业务逻辑在组件/纯函数内）：当前零命中",
    ).toBe(true);
  });
});
