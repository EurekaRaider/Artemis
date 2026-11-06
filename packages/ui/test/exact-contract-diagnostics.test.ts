import { describe, expect, it } from "vitest";
import {
  validateActionComponentContracts,
  ACTION_COMPONENT_CONTRACTS,
} from "../src/actions.js";
import {
  validateConversationComponentContracts,
  CONVERSATION_COMPONENT_CONTRACTS,
} from "../src/conversation.js";
import {
  validateDataComponentContracts,
  DATA_COMPONENT_CONTRACTS,
} from "../src/data.js";
import {
  validateFeedbackComponentContracts,
  FEEDBACK_COMPONENT_CONTRACTS,
} from "../src/feedback.js";
import {
  validateFormComponentContracts,
  FORM_COMPONENT_CONTRACTS,
} from "../src/forms.js";
import {
  validateLayoutComponentContracts,
  LAYOUT_COMPONENT_CONTRACTS,
} from "../src/layout.js";
import {
  validateManagementComponentContracts,
  MANAGEMENT_COMPONENT_CONTRACTS,
} from "../src/management.js";
import {
  validateNavigationComponentContracts,
  NAVIGATION_COMPONENT_CONTRACTS,
} from "../src/navigation.js";
import {
  validatePatternComponentContracts,
  PATTERN_COMPONENT_CONTRACTS,
} from "../src/patterns.js";
import {
  validateProfessionalComponentContracts,
  PROFESSIONAL_COMPONENT_CONTRACTS,
} from "../src/professional.js";
import {
  validateSurfaceComponentContracts,
  SURFACE_COMPONENT_CONTRACTS,
} from "../src/surfaces.js";
import {
  validateWorkflowComponentContracts,
  WORKFLOW_COMPONENT_CONTRACTS,
} from "../src/workflow.js";
import {
  validateWorkspaceComponentContracts,
  WORKSPACE_COMPONENT_CONTRACTS,
} from "../src/workspace.js";

const suites = [
  {
    name: "actions.tsx",
    validate: validateActionComponentContracts,
    contract: ACTION_COMPONENT_CONTRACTS,
    separateArrayType: true,
  },
  {
    name: "conversation.tsx",
    validate: validateConversationComponentContracts,
    contract: CONVERSATION_COMPONENT_CONTRACTS,
    separateArrayType: false,
  },
  {
    name: "data.tsx",
    validate: validateDataComponentContracts,
    contract: DATA_COMPONENT_CONTRACTS,
    separateArrayType: false,
  },
  {
    name: "feedback.tsx",
    validate: validateFeedbackComponentContracts,
    contract: FEEDBACK_COMPONENT_CONTRACTS,
    separateArrayType: false,
  },
  {
    name: "forms.tsx",
    validate: validateFormComponentContracts,
    contract: FORM_COMPONENT_CONTRACTS,
    separateArrayType: true,
  },
  {
    name: "layout.tsx",
    validate: validateLayoutComponentContracts,
    contract: LAYOUT_COMPONENT_CONTRACTS,
    separateArrayType: false,
  },
  {
    name: "management.tsx",
    validate: validateManagementComponentContracts,
    contract: MANAGEMENT_COMPONENT_CONTRACTS,
    separateArrayType: false,
  },
  {
    name: "navigation.tsx",
    validate: validateNavigationComponentContracts,
    contract: NAVIGATION_COMPONENT_CONTRACTS,
    separateArrayType: true,
  },
  {
    name: "patterns.tsx",
    validate: validatePatternComponentContracts,
    contract: PATTERN_COMPONENT_CONTRACTS,
    separateArrayType: false,
  },
  {
    name: "professional.tsx",
    validate: validateProfessionalComponentContracts,
    contract: PROFESSIONAL_COMPONENT_CONTRACTS,
    separateArrayType: false,
  },
  {
    name: "surfaces.tsx",
    validate: validateSurfaceComponentContracts,
    contract: SURFACE_COMPONENT_CONTRACTS,
    separateArrayType: false,
  },
  {
    name: "workflow.tsx",
    validate: validateWorkflowComponentContracts,
    contract: WORKFLOW_COMPONENT_CONTRACTS,
    separateArrayType: false,
  },
  {
    name: "workspace.tsx",
    validate: validateWorkspaceComponentContracts,
    contract: WORKSPACE_COMPONENT_CONTRACTS,
    separateArrayType: false,
  },
];
describe.each(suites)(
  "$name exact contract diagnostics",
  ({ name: family, validate, contract, separateArrayType }) => {
    const name = Object.keys(contract)[0]!;
    const expected = (
      contract as Record<
        string,
        {
          parts: readonly string[];
          schemaVersion: number;
          uiContractVersion: number;
        }
      >
    )[name]!;
    const fresh = () => structuredClone(contract) as Record<string, any>;
    it("accepts the contract and freezes the report and errors", () => {
      const report = validate(contract);
      expect(report).toEqual({ valid: true, errors: [] });
      expect(Object.isFrozen(report)).toBe(true);
      expect(Object.isFrozen(report.errors)).toBe(true);
    });
    it("preserves root object and exact-key errors", () => {
      expect(validate(null).errors).toEqual(["contracts must be an object"]);
      const value = fresh();
      value.unexpected = {};
      expect(validate(value).errors).toEqual([
        "contracts fields are not exact",
      ]);
      delete value.unexpected;
      delete value[name];
      expect(validate(value).errors).toEqual([
        "contracts fields are not exact",
      ]);
    });
    it("preserves each family's non-array diagnostic", () => {
      const value = fresh();
      value[name].parts = null;
      expect(validate(value).errors).toEqual([
        `contracts.${name}.parts ${separateArrayType ? "must be an array" : "must contain " + expected.parts.length + " entries"}`,
      ]);
      expect(value[name].parts).toBeNull();
    });
    it("preserves array length and item paths", () => {
      const value = fresh();
      value[name].parts = [];
      expect(validate(value).errors).toEqual([
        `contracts.${name}.parts must contain ${expected.parts.length} entries`,
      ]);
      value[name].parts = [...expected.parts];
      value[name].parts[0] = 0;
      expect(validate(value).errors).toEqual([
        `contracts.${name}.parts[0] must equal ${["professional.tsx", "workflow.tsx"].includes(family) ? String(expected.parts[0]) : JSON.stringify(expected.parts[0])}`,
      ]);
    });
    it("reports all scalar mismatches in sorted-key order", () => {
      const value = fresh();
      value[name].schemaVersion = 999;
      value[name].uiContractVersion = 999;
      expect(validate(value).errors).toEqual([
        `contracts.${name}.schemaVersion must equal ${expected.schemaVersion}`,
        `contracts.${name}.uiContractVersion must equal ${expected.uiContractVersion}`,
      ]);
    });
    it("stops at mismatched nested objects without inventing child errors", () => {
      const value = fresh();
      value[name].theme = { ...value[name].theme, extra: true };
      expect(validate(value).errors).toEqual([
        `contracts.${name}.theme fields are not exact`,
      ]);
      value[name] = [];
      expect(validate(value).errors).toEqual([
        `contracts.${name} must be an object`,
      ]);
    });
  },
);
