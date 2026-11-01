import { describe, expect, it } from "vitest";

import { evaluateFormControlFocusEvidence } from "../../scripts/verify/ui/form-controls-focus-evidence.mjs";

const focusedInput = {
  windowFocused: true,
  documentHasFocus: true,
  focusRing: "#8f5f00",
  component: {
    control: { documentActive: true, tabIndex: 0 },
    focus: {
      outlineStyle: "solid",
      outlineWidth: "2px",
      outlineColor: "rgb(143, 95, 0)",
    },
  },
};

describe("native form focus evidence", () => {
  it("accepts a truly focused input with the theme focus ring", () => {
    expect(evaluateFormControlFocusEvidence(focusedInput).pass).toBe(true);
  });

  it.each(["windowFocused", "documentHasFocus"])(
    "rejects focus evidence when %s is false",
    (key) => {
      expect(
        evaluateFormControlFocusEvidence({ ...focusedInput, [key]: false })
          .pass,
      ).toBe(false);
    },
  );

  it("rejects the old inactive-foreground fallback", () => {
    expect(
      evaluateFormControlFocusEvidence({
        ...focusedInput,
        windowFocused: false,
        documentHasFocus: false,
      }).pass,
    ).toBe(false);
  });

  it.each([
    { documentActive: false, tabIndex: 0 },
    { documentActive: true, tabIndex: -1 },
  ])("rejects an unfocused or non-tabbable target %j", (control) => {
    expect(
      evaluateFormControlFocusEvidence({
        ...focusedInput,
        component: { ...focusedInput.component, control },
      }).pass,
    ).toBe(false);
  });

  it.each([
    { outlineStyle: "none", outlineWidth: "0px" },
    { outlineWidth: "0px" },
    { outlineWidth: undefined },
    { outlineStyle: undefined },
    { outlineColor: undefined },
    { outlineColor: "rgba(128, 188, 254, 0.6)" },
  ])("rejects missing, invisible, or system-blue focus %j", (focus) => {
    expect(
      evaluateFormControlFocusEvidence({
        ...focusedInput,
        component: {
          ...focusedInput.component,
          focus: { ...focusedInput.component.focus, ...focus },
        },
      }).pass,
    ).toBe(false);
  });

  it("uses the checkbox's visible indicator instead of its hidden input", () => {
    const component = {
      ...focusedInput.component,
      focus: {
        outlineStyle: "none",
        outlineWidth: "0px",
        outlineColor: "rgb(0, 0, 0)",
        visualOutlineStyle: "solid",
        visualOutlineWidth: "2px",
        visualOutlineColor: "rgb(242, 200, 119)",
      },
    };
    expect(
      evaluateFormControlFocusEvidence({
        ...focusedInput,
        focusRing: "#f2c877",
        visual: true,
        component,
      }).pass,
    ).toBe(true);
    expect(
      evaluateFormControlFocusEvidence({
        ...focusedInput,
        focusRing: "#f2c877",
        visual: true,
        component: {
          ...component,
          focus: { ...component.focus, visualOutlineStyle: "none" },
        },
      }).pass,
    ).toBe(false);
  });

  it("permits the system focus color only in forced-colors mode", () => {
    const evidence = {
      ...focusedInput,
      forcedColors: true,
      component: {
        ...focusedInput.component,
        focus: {
          ...focusedInput.component.focus,
          outlineColor: "rgb(255, 255, 255)",
        },
      },
    };
    expect(evaluateFormControlFocusEvidence(evidence).pass).toBe(true);
    expect(
      evaluateFormControlFocusEvidence({ ...evidence, windowFocused: false })
        .pass,
    ).toBe(false);
    expect(
      evaluateFormControlFocusEvidence({
        ...evidence,
        component: {
          ...evidence.component,
          focus: { ...evidence.component.focus, outlineColor: "transparent" },
        },
      }).pass,
    ).toBe(false);
  });
});
