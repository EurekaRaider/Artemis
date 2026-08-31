// D#76 PR10C review batch B1 (severe 1) — policy regression pin.
//
// AGENTS.md: "Tests for a policy regression precede any relaxation of
// these boundaries." The multi-question UI smoke seeding channel in
// main.ts previously armed on a bare ARTEMIS_SMOKE_VIEW=multi-question-ui*
// match alone, unlike the sibling fixtures (seedSmokeUserInputFixture
// requires ARTEMIS_SMOKE_USER_INPUT; the transport/input-fields drivers
// require ARTEMIS_SMOKE_SCREENSHOT). These source probes pin the dedicated
// ARTEMIS_SMOKE_MULTI_UI sentinel contract so the gate cannot silently
// regress. The repo has no main.ts unit-test precedent (verified by grep),
// so the probes follow the established source-probe convention
// (renderer-layout.test.ts, multi-question-user-input-card.test.tsx).
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const mainSource = readFileSync(
  fileURLToPath(new URL("../src/main/main.ts", import.meta.url)),
  "utf8",
);
const verifyScriptSource = readFileSync(
  fileURLToPath(
    new URL("../scripts/verify-user-input-multi-ui.mjs", import.meta.url),
  ),
  "utf8",
);

const SENTINEL_CHECK = 'process.env.ARTEMIS_SMOKE_MULTI_UI !== "1"';
const SENTINEL_PASS = 'process.env.ARTEMIS_SMOKE_MULTI_UI === "1"';
const VIEW_PREFIX_CHECK = 'startsWith("multi-question-ui")';

describe("smoke multi-question UI sentinel gate (D#76 PR10C review, severe 1)", () => {
  it("gates seedSmokeMultiQuestionUiFixture on the sentinel AND the view prefix, before any store write", () => {
    const functionStart = mainSource.indexOf(
      "async function seedSmokeMultiQuestionUiFixture",
    );
    expect(
      functionStart,
      "main.ts 缺少 seedSmokeMultiQuestionUiFixture",
    ).toBeGreaterThan(-1);
    const firstStoreWrite = mainSource.indexOf(
      "store.upsertProject",
      functionStart,
    );
    const guardRegion = mainSource.slice(functionStart, firstStoreWrite);
    // Both conditions must live inside the early-return guard (before its
    // return statement), not somewhere later in the function body.
    const guardReturn = guardRegion.indexOf("return;");
    expect(guardReturn, "种子函数缺少哨兵守卫的 early return").toBeGreaterThan(
      -1,
    );
    const guardHead = guardRegion.slice(0, guardReturn);
    expect(
      guardHead.includes(SENTINEL_CHECK),
      '种子函数守卫必须检查专用哨兵 process.env.ARTEMIS_SMOKE_MULTI_UI !== "1"（仿 seedSmokeUserInputFixture 的 ARTEMIS_SMOKE_USER_INPUT 惯例）',
    ).toBe(true);
    expect(
      guardHead.includes(VIEW_PREFIX_CHECK),
      '种子函数守卫必须同时要求 ARTEMIS_SMOKE_VIEW 带 multi-question-ui 前缀（startsWith("multi-question-ui")）',
    ).toBe(true);
  });

  it("treats a sentinel-less multi-question-ui view as unknown in the prepareSmokeView activation path", () => {
    const activationPoint = mainSource.indexOf("const prepareSmokeView");
    expect(
      activationPoint,
      "main.ts 缺少 prepareSmokeView 激活点",
    ).toBeGreaterThan(-1);
    // The view gate normalizes ARTEMIS_SMOKE_VIEW just before the
    // activation ternary; the window below measures ~735 source characters
    // today and stays bounded by the surrounding smoke-setup block.
    const gateRegion = mainSource.slice(
      Math.max(0, activationPoint - 1_600),
      activationPoint,
    );
    expect(
      gateRegion.includes(VIEW_PREFIX_CHECK),
      "prepareSmokeView 激活路径必须判别 multi-question-ui 视图前缀",
    ).toBe(true);
    expect(
      gateRegion.includes(SENTINEL_PASS),
      'prepareSmokeView 激活路径必须引用 ARTEMIS_SMOKE_MULTI_UI（=== "1" 才放行）：哨兵缺失时 multi-question-ui 视图按未知处理、不激活',
    ).toBe(true);
  });

  it("launches the multi-question UI evidence driver with ARTEMIS_SMOKE_MULTI_UI set", () => {
    expect(
      /ARTEMIS_SMOKE_MULTI_UI:\s*"1"/.test(verifyScriptSource),
      'verify-user-input-multi-ui.mjs 必须在 Electron 启动 env 注入 ARTEMIS_SMOKE_MULTI_UI: "1"，否则种子与视图激活双双不生效',
    ).toBe(true);
  });
});
