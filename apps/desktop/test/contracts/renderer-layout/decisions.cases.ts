import { describe, expect, it } from "vitest";

import {
  appSource,
  approvalDecisionSource,
  userInputSource,
  decisionSource,
  smokeSource,
  cssRule,
} from "../../fixtures/application/layout-contract.js";
describe("renderer layout contract", () => {
  it("isolates dynamic approval copy from surrounding RTL direction", () => {
    expect(approvalDecisionSource).toContain("<bdi>{view.detail}</bdi>");
    expect(approvalDecisionSource).toContain("<bdi>{approval.summary}</bdi>");
    expect(smokeSource).toContain("name: 'bidi-' + selector");
  });
  it("uses shared decision cards for pending and completed approvals", () => {
    expect(appSource).toContain("<ApprovalDecisionCard");
    expect(approvalDecisionSource).toContain(
      'if (approval.status !== "pending")',
    );
    expect(approvalDecisionSource).toContain("<DecisionResult");
    expect(approvalDecisionSource).toContain("<DecisionOptions");
  });
  it("moves pending decisions into the composer and keeps completed summaries in the timeline", () => {
    const composerStart = appSource.indexOf('<div className="composer-wrap">');
    const composerContext = appSource.indexOf(
      "<ComposerContextBar",
      composerStart,
    );
    const timelineStart = appSource.indexOf("function Timeline(");
    const timelineSource = appSource.slice(timelineStart);
    const cardHeader = userInputSource.slice(
      userInputSource.indexOf("<header>"),
      userInputSource.indexOf("</header>"),
    );

    expect(appSource).toContain("activePendingDecisionId");
    expect(composerStart).toBeGreaterThan(-1);
    expect(composerContext).toBeGreaterThan(composerStart);
    expect(
      appSource.indexOf("<DecisionComposer", composerStart),
    ).toBeGreaterThan(composerStart);
    expect(appSource).toContain("decision={pendingComposerDecision}");
    expect(timelineSource).toContain("active={false}");
    expect(timelineSource).toContain(
      'input.status === "pending") return null;',
    );
    expect(timelineSource).toContain(
      'approval.status === "pending") return null;',
    );
    expect(cardHeader).toContain("dateTime={input.expiresAt}");
    expect(cardHeader).toContain("formatUserInputCountdown(");
    expect(userInputSource).not.toContain("new ResizeObserver");
    expect(decisionSource).toContain("moveUserInputOptionFocus(");
    expect(decisionSource).toContain('role="group"');
    expect(decisionSource).toContain('type="button"');
  });
  it("keeps a turn stop control while a timeline decision disables the composer", () => {
    expect(appSource).toContain("window.artemis.cancelTurn(activeThreadId)");
    expect(appSource).toContain("onClick={() => void cancelActiveTurn()}");
    expect(appSource).toContain('className="timeline-decision"');
    expect(appSource).toContain("decisionTarget={decisionTarget}");
    expect(appSource).toContain("disabled={Boolean(pendingComposerDecision)}");
    expect(userInputSource).not.toContain("onCancel");
    expect(decisionSource).toContain('className="decision-reply"');
    expect(decisionSource).toContain("disabled={busy || !draft.trim()}");
  });
  it("renders the three selectable approval policies and persists the selected policy", () => {
    expect(appSource).toContain('className="approval-policy-trigger"');
    expect(appSource).toContain('className="approval-policy-menu"');
    expect(appSource).toContain('changeApprovalPolicy("ask")');
    expect(appSource).toContain('changeApprovalPolicy("agent")');
    expect(appSource).toContain('changeApprovalPolicy("full-access")');
    expect(appSource).not.toContain('changeApprovalPolicy("custom")');
    expect(appSource).toContain("window.artemis.setApprovalPolicy(policy)");
    expect(cssRule(".approval-policy-control")).toMatch(
      /\bposition:\s*static/u,
    );
    expect(cssRule(".approval-policy-menu")).toMatch(
      /\bbox-sizing:\s*border-box[\s\S]*\binset-inline-start:\s*var\(--approval-anchor, 12px\)[\s\S]*\boverflow-y:\s*auto[\s\S]*\bposition:\s*absolute[\s\S]*\bwidth:\s*min\(300px,\s*calc\(100%\s*-\s*24px\)\)/u,
    );
  });
});
