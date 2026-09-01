import { describe, expect, it } from "vitest";

import {
  ARTEMIS_UI_ROOT_ATTRIBUTE_NAMES,
  COMPONENT_CONTRACT_SCHEMA_VERSION,
  UI_CONTRACT_VERSION,
  validateComponentContract,
} from "../src/index.js";
import { CONFORMANCE_PROBE_CONTRACT } from "../src/conformance.js";

describe("@artemis/ui CL0A boundary", () => {
  it("exports only the versioned root attribute contract", () => {
    expect(UI_CONTRACT_VERSION).toBe(1);
    expect(ARTEMIS_UI_ROOT_ATTRIBUTE_NAMES).toEqual([
      "data-artemis-skin",
      "data-artemis-theme",
      "data-artemis-contrast",
    ]);
  });

  it("validates the frozen component contract schema", () => {
    expect(COMPONENT_CONTRACT_SCHEMA_VERSION).toBe(1);
    expect(validateComponentContract(CONFORMANCE_PROBE_CONTRACT)).toEqual({
      valid: true,
      issues: [],
      value: CONFORMANCE_PROBE_CONTRACT,
    });
  });

  it("fails closed for unknown, missing, duplicate, and illegal data attributes", () => {
    const unknown = validateComponentContract({
      ...CONFORMANCE_PROBE_CONTRACT,
      executable: true,
    });
    expect(unknown.valid).toBe(false);
    expect(unknown.issues.map((issue) => issue.code)).toContain(
      "unknown_field",
    );

    const { aria: _aria, ...missingAria } = CONFORMANCE_PROBE_CONTRACT;
    const missing = validateComponentContract(missingAria);
    expect(missing.valid).toBe(false);
    expect(missing.issues.map((issue) => issue.code)).toContain(
      "missing_field",
    );

    const duplicate = validateComponentContract({
      ...CONFORMANCE_PROBE_CONTRACT,
      parts: [
        ...CONFORMANCE_PROBE_CONTRACT.parts,
        CONFORMANCE_PROBE_CONTRACT.parts[0],
      ],
    });
    expect(duplicate.valid).toBe(false);
    expect(duplicate.issues.map((issue) => issue.code)).toContain(
      "duplicate_entry",
    );

    const illegalDataAttribute = validateComponentContract({
      ...CONFORMANCE_PROBE_CONTRACT,
      dataAttributes: {
        ...CONFORMANCE_PROBE_CONTRACT.dataAttributes,
        state: "data-skin-state",
      },
    });
    expect(illegalDataAttribute.valid).toBe(false);
    expect(illegalDataAttribute.issues.map((issue) => issue.code)).toContain(
      "illegal_data_attribute",
    );
  });

  it("rejects inherited top-level and nested objects", () => {
    expect(
      validateComponentContract(Object.create(CONFORMANCE_PROBE_CONTRACT))
        .valid,
    ).toBe(false);
    expect(
      validateComponentContract({
        ...CONFORMANCE_PROBE_CONTRACT,
        aria: Object.create(CONFORMANCE_PROBE_CONTRACT.aria),
      }).valid,
    ).toBe(false);
  });

  it("directly rejects invalid v1 cross-field semantics", () => {
    const callbackTypeMismatch = validateComponentContract({
      ...CONFORMANCE_PROBE_CONTRACT,
      props: CONFORMANCE_PROBE_CONTRACT.props.map((prop) =>
        prop.name === "onCommit" ? { ...prop, type: "string" } : prop,
      ),
    });
    const wrongControlReference = validateComponentContract({
      ...CONFORMANCE_PROBE_CONTRACT,
      controlBoundary: {
        ...CONFORMANCE_PROBE_CONTRACT.controlBoundary,
        value: "label",
      },
    });
    const missingAriaAnatomy = validateComponentContract({
      ...CONFORMANCE_PROBE_CONTRACT,
      parts: [CONFORMANCE_PROBE_CONTRACT.parts[0]],
    });
    const unsafeDisabledState = validateComponentContract({
      ...CONFORMANCE_PROBE_CONTRACT,
      states: CONFORMANCE_PROBE_CONTRACT.states.map((state) =>
        state.name === "disabled" ? { ...state, focus: "allow" } : state,
      ),
    });
    const unsafeComposition = validateComponentContract({
      ...CONFORMANCE_PROBE_CONTRACT,
      keyboard: CONFORMANCE_PROBE_CONTRACT.keyboard.map((entry) =>
        entry.duringComposition ? { ...entry, outcome: "commit-once" } : entry,
      ),
    });
    const wrongCallbackOrder = validateComponentContract({
      ...CONFORMANCE_PROBE_CONTRACT,
      callbacks: CONFORMANCE_PROBE_CONTRACT.callbacks.map((entry) =>
        entry.trigger === "change"
          ? { ...entry, order: [...entry.order].reverse() }
          : entry,
      ),
    });
    const optionalLabel = validateComponentContract({
      ...CONFORMANCE_PROBE_CONTRACT,
      props: CONFORMANCE_PROBE_CONTRACT.props.map((prop) =>
        prop.name === "label" ? { ...prop, required: false } : prop,
      ),
    });
    const missingLabel = validateComponentContract({
      ...CONFORMANCE_PROBE_CONTRACT,
      props: CONFORMANCE_PROBE_CONTRACT.props.filter(
        (prop) => prop.name !== "label",
      ),
    });

    for (const report of [
      callbackTypeMismatch,
      wrongControlReference,
      missingAriaAnatomy,
      unsafeDisabledState,
      unsafeComposition,
      wrongCallbackOrder,
      optionalLabel,
      missingLabel,
    ]) {
      expect(report.valid).toBe(false);
      expect(report.issues.length).toBeGreaterThan(0);
    }
  });
});
