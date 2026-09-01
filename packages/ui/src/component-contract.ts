export const COMPONENT_CONTRACT_SCHEMA_VERSION = 1 as const;

export type ComponentPropKind =
  "boolean" | "callback" | "identifier" | "string";
export type ComponentPropBoundary =
  "callback" | "controlled" | "uncontrolled-default" | "static";
export type ComponentActionPolicy = "allow" | "block";

export interface ComponentPropContract {
  readonly name: string;
  readonly type: ComponentPropKind;
  readonly required: boolean;
  readonly boundary: ComponentPropBoundary;
}

export interface ComponentPartContract {
  readonly name: string;
  readonly element: "button" | "div" | "input" | "label" | "p" | "span";
}

export interface ComponentStateContract {
  readonly name: string;
  readonly dataValue: string;
  readonly priority: number;
  readonly change: ComponentActionPolicy;
  readonly commit: ComponentActionPolicy;
  readonly focus: ComponentActionPolicy;
}

export interface ComponentContract {
  readonly schemaVersion: typeof COMPONENT_CONTRACT_SCHEMA_VERSION;
  readonly uiContractVersion: 1;
  readonly name: string;
  readonly props: readonly ComponentPropContract[];
  readonly controlBoundary: {
    readonly value: string;
    readonly defaultValue: string;
    readonly changeCallback: string;
    readonly fixedAtMount: true;
    readonly mutuallyExclusive: true;
  };
  readonly parts: readonly ComponentPartContract[];
  readonly dataAttributes: {
    readonly component: "data-artemis-component";
    readonly part: "data-part";
    readonly state: "data-state";
  };
  readonly states: readonly ComponentStateContract[];
  readonly aria: {
    readonly rootRole: "group";
    readonly accessibleName: "label-element";
    readonly labelRelation: "for-control";
    readonly descriptionRelation: "aria-describedby";
    readonly errorRelation: "aria-describedby";
    readonly invalidRelation: "aria-invalid";
    readonly busyRelation: "aria-busy";
  };
  readonly keyboard: readonly {
    readonly key: "Enter";
    readonly when: "control-focused";
    readonly duringComposition: boolean;
    readonly outcome: "commit-once" | "no-commit";
  }[];
  readonly callbacks: readonly {
    readonly trigger: "change" | "commit";
    readonly order: readonly string[];
    readonly callsPerEvent: 1;
  }[];
  readonly portal: {
    readonly mode: "none";
    readonly themeInheritance: "same-dom-tree";
    readonly layer: "artemis.ui";
  };
  readonly theme: {
    readonly direction: "inherit";
    readonly reducedMotion: "disable-transitions";
    readonly mutableTokens: readonly `--artemis-${string}`[];
    readonly safetyFloor: readonly (
      | "accessible-name-required"
      | "disabled-native-semantics"
      | "focus-indicator-visible"
      | "no-action-while-busy"
      | "no-action-while-disabled"
    )[];
  };
}

export type ComponentContractIssueCode =
  | "duplicate_entry"
  | "illegal_data_attribute"
  | "invalid_field"
  | "invalid_type"
  | "invalid_value"
  | "missing_field"
  | "unknown_field";

export interface ComponentContractIssue {
  readonly code: ComponentContractIssueCode;
  readonly path: string;
  readonly message: string;
}

export interface ComponentContractReport {
  readonly valid: boolean;
  readonly issues: readonly ComponentContractIssue[];
  readonly value?: ComponentContract;
}

const TOP_FIELDS = [
  "schemaVersion",
  "uiContractVersion",
  "name",
  "props",
  "controlBoundary",
  "parts",
  "dataAttributes",
  "states",
  "aria",
  "keyboard",
  "callbacks",
  "portal",
  "theme",
] as const;
const PROP_FIELDS = ["name", "type", "required", "boundary"] as const;
const PART_FIELDS = ["name", "element"] as const;
const STATE_FIELDS = [
  "name",
  "dataValue",
  "priority",
  "change",
  "commit",
  "focus",
] as const;
const CONTROL_FIELDS = [
  "value",
  "defaultValue",
  "changeCallback",
  "fixedAtMount",
  "mutuallyExclusive",
] as const;
const DATA_FIELDS = ["component", "part", "state"] as const;
const ARIA_FIELDS = [
  "rootRole",
  "accessibleName",
  "labelRelation",
  "descriptionRelation",
  "errorRelation",
  "invalidRelation",
  "busyRelation",
] as const;
const KEYBOARD_FIELDS = [
  "key",
  "when",
  "duringComposition",
  "outcome",
] as const;
const CALLBACK_FIELDS = ["trigger", "order", "callsPerEvent"] as const;
const PORTAL_FIELDS = ["mode", "themeInheritance", "layer"] as const;
const THEME_FIELDS = [
  "direction",
  "reducedMotion",
  "mutableTokens",
  "safetyFloor",
] as const;

const PROP_TYPES = ["boolean", "callback", "identifier", "string"] as const;
const PROP_BOUNDARIES = [
  "callback",
  "controlled",
  "uncontrolled-default",
  "static",
] as const;
const PART_ELEMENTS = ["button", "div", "input", "label", "p", "span"] as const;
const ACTION_POLICIES = ["allow", "block"] as const;
const SAFETY_FLOOR = [
  "accessible-name-required",
  "disabled-native-semantics",
  "focus-indicator-visible",
  "no-action-while-busy",
  "no-action-while-disabled",
] as const;
const REQUIRED_PARTS = {
  root: "div",
  label: "label",
  control: "input",
  description: "p",
  error: "p",
} as const;
const FROZEN_STATES = {
  ready: {
    dataValue: "ready",
    priority: 0,
    change: "allow",
    commit: "allow",
    focus: "allow",
  },
  error: {
    dataValue: "error",
    priority: 1,
    change: "allow",
    commit: "allow",
    focus: "allow",
  },
  stale: {
    dataValue: "stale",
    priority: 2,
    change: "allow",
    commit: "allow",
    focus: "allow",
  },
  busy: {
    dataValue: "busy",
    priority: 3,
    change: "block",
    commit: "block",
    focus: "allow",
  },
  disabled: {
    dataValue: "disabled",
    priority: 4,
    change: "block",
    commit: "block",
    focus: "block",
  },
} as const;
const IDENTIFIER_PATTERN = /^[a-z][A-Za-z0-9]*$/u;
const COMPONENT_NAME_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u;
const TOKEN_PATTERN = /^--artemis-[a-z0-9]+(?:-[a-z0-9]+)*$/u;

function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function addIssue(
  issues: ComponentContractIssue[],
  code: ComponentContractIssueCode,
  path: string,
  message: string,
): void {
  issues.push({ code, path, message });
}

function exactFields(
  value: Record<string, unknown>,
  fields: readonly string[],
  path: string,
  issues: ComponentContractIssue[],
): void {
  const allowed = new Set(fields);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      addIssue(
        issues,
        "unknown_field",
        `${path}.${key}`,
        `Unknown field: ${key}`,
      );
    }
  }
  for (const field of fields) {
    if (!Object.hasOwn(value, field)) {
      addIssue(
        issues,
        "missing_field",
        `${path}.${field}`,
        `Missing field: ${field}`,
      );
    }
  }
}

function enumValue(
  value: unknown,
  allowed: readonly string[],
  path: string,
  issues: ComponentContractIssue[],
): value is string {
  if (typeof value !== "string") {
    addIssue(issues, "invalid_type", path, "Expected a string");
    return false;
  }
  if (!allowed.includes(value)) {
    addIssue(
      issues,
      "invalid_value",
      path,
      "Value is outside the v1 allowlist",
    );
    return false;
  }
  return true;
}

function namedRecords(
  value: unknown,
  fields: readonly string[],
  path: string,
  issues: ComponentContractIssue[],
): Record<string, unknown>[] {
  if (!Array.isArray(value) || value.length === 0) {
    addIssue(issues, "invalid_type", path, "Expected a non-empty array");
    return [];
  }
  const records: Record<string, unknown>[] = [];
  const names = new Set<string>();
  for (const [index, entry] of value.entries()) {
    const entryPath = `${path}[${index}]`;
    if (!isRecord(entry)) {
      addIssue(issues, "invalid_type", entryPath, "Expected a plain object");
      continue;
    }
    exactFields(entry, fields, entryPath, issues);
    if (typeof entry.name === "string") {
      if (names.has(entry.name)) {
        addIssue(
          issues,
          "duplicate_entry",
          `${entryPath}.name`,
          `Duplicate entry: ${entry.name}`,
        );
      }
      names.add(entry.name);
    }
    records.push(entry);
  }
  return records;
}

function exactRecord(
  value: unknown,
  fields: readonly string[],
  path: string,
  issues: ComponentContractIssue[],
): Record<string, unknown> | undefined {
  if (!isRecord(value)) {
    addIssue(issues, "invalid_type", path, "Expected a plain object");
    return undefined;
  }
  exactFields(value, fields, path, issues);
  return value;
}

function stringArray(
  value: unknown,
  path: string,
  issues: ComponentContractIssue[],
  pattern?: RegExp,
): string[] {
  if (!Array.isArray(value) || value.length === 0) {
    addIssue(issues, "invalid_type", path, "Expected a non-empty string array");
    return [];
  }
  const strings: string[] = [];
  const seen = new Set<string>();
  for (const [index, item] of value.entries()) {
    const itemPath = `${path}[${index}]`;
    if (typeof item !== "string") {
      addIssue(issues, "invalid_type", itemPath, "Expected a string");
      continue;
    }
    if (pattern !== undefined && !pattern.test(item)) {
      addIssue(
        issues,
        "invalid_value",
        itemPath,
        "String is outside the v1 allowlist",
      );
    }
    if (seen.has(item)) {
      addIssue(issues, "duplicate_entry", itemPath, `Duplicate entry: ${item}`);
    }
    seen.add(item);
    strings.push(item);
  }
  return strings;
}

export function validateComponentContract(
  input: unknown,
): ComponentContractReport {
  const issues: ComponentContractIssue[] = [];
  const contract = exactRecord(input, TOP_FIELDS, "$", issues);
  if (contract === undefined) return { valid: false, issues };

  if (contract.schemaVersion !== COMPONENT_CONTRACT_SCHEMA_VERSION) {
    addIssue(
      issues,
      "invalid_value",
      "$.schemaVersion",
      "Only schemaVersion 1 is supported",
    );
  }
  if (contract.uiContractVersion !== 1) {
    addIssue(
      issues,
      "invalid_value",
      "$.uiContractVersion",
      "Only UI contract version 1 is supported",
    );
  }
  if (
    typeof contract.name !== "string" ||
    !COMPONENT_NAME_PATTERN.test(contract.name)
  ) {
    addIssue(
      issues,
      "invalid_value",
      "$.name",
      "Expected a lowercase component identifier",
    );
  }

  const props = namedRecords(contract.props, PROP_FIELDS, "$.props", issues);
  const propNames = new Set<string>();
  const propBoundaries = new Map<string, unknown>();
  const propTypes = new Map<string, unknown>();
  const callbackProps = new Set<string>();
  for (const [index, prop] of props.entries()) {
    const path = `$.props[${index}]`;
    if (typeof prop.name !== "string" || !IDENTIFIER_PATTERN.test(prop.name)) {
      addIssue(
        issues,
        "invalid_value",
        `${path}.name`,
        "Expected a public prop identifier",
      );
    } else {
      propNames.add(prop.name);
      propBoundaries.set(prop.name, prop.boundary);
      propTypes.set(prop.name, prop.type);
      if (prop.boundary === "callback") callbackProps.add(prop.name);
    }
    enumValue(prop.type, PROP_TYPES, `${path}.type`, issues);
    enumValue(prop.boundary, PROP_BOUNDARIES, `${path}.boundary`, issues);
    if ((prop.type === "callback") !== (prop.boundary === "callback")) {
      addIssue(
        issues,
        "invalid_value",
        path,
        "Callback type and callback boundary must be declared together",
      );
    }
    if (
      (prop.boundary === "controlled" ||
        prop.boundary === "uncontrolled-default") &&
      prop.type !== "string"
    ) {
      addIssue(
        issues,
        "invalid_value",
        path,
        "Controlled and uncontrolled-default props must be strings",
      );
    }
    if (typeof prop.required !== "boolean") {
      addIssue(
        issues,
        "invalid_type",
        `${path}.required`,
        "Expected a boolean",
      );
    }
  }

  const control = exactRecord(
    contract.controlBoundary,
    CONTROL_FIELDS,
    "$.controlBoundary",
    issues,
  );
  if (control !== undefined) {
    const expectedBoundaries = {
      value: "controlled",
      defaultValue: "uncontrolled-default",
      changeCallback: "callback",
    } as const;
    const expectedTypes = {
      value: "string",
      defaultValue: "string",
      changeCallback: "callback",
    } as const;
    for (const key of ["value", "defaultValue", "changeCallback"] as const) {
      if (typeof control[key] !== "string" || !propNames.has(control[key])) {
        addIssue(
          issues,
          "invalid_value",
          `$.controlBoundary.${key}`,
          "Must reference a declared public prop",
        );
      } else if (propBoundaries.get(control[key]) !== expectedBoundaries[key]) {
        addIssue(
          issues,
          "invalid_value",
          `$.controlBoundary.${key}`,
          `Referenced prop must use the ${expectedBoundaries[key]} boundary`,
        );
      } else if (propTypes.get(control[key]) !== expectedTypes[key]) {
        addIssue(
          issues,
          "invalid_value",
          `$.controlBoundary.${key}`,
          `Referenced prop must use the ${expectedTypes[key]} type`,
        );
      }
    }
    if (control.fixedAtMount !== true || control.mutuallyExclusive !== true) {
      addIssue(
        issues,
        "invalid_value",
        "$.controlBoundary",
        "The controlled boundary must be exclusive and fixed at mount",
      );
    }
  }

  const parts = namedRecords(contract.parts, PART_FIELDS, "$.parts", issues);
  const partElements = new Map<string, unknown>();
  for (const [index, part] of parts.entries()) {
    const path = `$.parts[${index}]`;
    if (
      typeof part.name !== "string" ||
      !COMPONENT_NAME_PATTERN.test(part.name)
    ) {
      addIssue(
        issues,
        "invalid_value",
        `${path}.name`,
        "Expected a part identifier",
      );
    } else partElements.set(part.name, part.element);
    enumValue(part.element, PART_ELEMENTS, `${path}.element`, issues);
  }
  for (const [name, element] of Object.entries(REQUIRED_PARTS)) {
    if (!partElements.has(name)) {
      addIssue(
        issues,
        "missing_field",
        "$.parts",
        `Required ARIA anatomy part is missing: ${name}`,
      );
    } else if (partElements.get(name) !== element) {
      addIssue(
        issues,
        "invalid_value",
        `$.parts.${name}`,
        `ARIA anatomy part ${name} must use ${element}`,
      );
    }
  }

  const data = exactRecord(
    contract.dataAttributes,
    DATA_FIELDS,
    "$.dataAttributes",
    issues,
  );
  if (data !== undefined) {
    const required = {
      component: "data-artemis-component",
      part: "data-part",
      state: "data-state",
    } as const;
    for (const key of DATA_FIELDS) {
      if (data[key] !== required[key]) {
        addIssue(
          issues,
          "illegal_data_attribute",
          `$.dataAttributes.${key}`,
          `Expected ${required[key]}`,
        );
      }
    }
  }

  const states = namedRecords(
    contract.states,
    STATE_FIELDS,
    "$.states",
    issues,
  );
  const stateNames = new Set<string>();
  const statesByName = new Map<string, Record<string, unknown>>();
  const stateValues = new Set<string>();
  const priorities = new Set<number>();
  for (const [index, state] of states.entries()) {
    const path = `$.states[${index}]`;
    if (
      typeof state.name !== "string" ||
      !COMPONENT_NAME_PATTERN.test(state.name)
    ) {
      addIssue(
        issues,
        "invalid_value",
        `${path}.name`,
        "Expected a state identifier",
      );
    } else {
      stateNames.add(state.name);
      statesByName.set(state.name, state);
    }
    if (
      typeof state.dataValue !== "string" ||
      !COMPONENT_NAME_PATTERN.test(state.dataValue)
    ) {
      addIssue(
        issues,
        "invalid_value",
        `${path}.dataValue`,
        "Expected a finite data-state value",
      );
    } else if (stateValues.has(state.dataValue)) {
      addIssue(
        issues,
        "duplicate_entry",
        `${path}.dataValue`,
        `Duplicate data-state value: ${state.dataValue}`,
      );
    } else stateValues.add(state.dataValue);
    if (!Number.isInteger(state.priority) || (state.priority as number) < 0) {
      addIssue(
        issues,
        "invalid_value",
        `${path}.priority`,
        "Expected a non-negative integer priority",
      );
    } else if (priorities.has(state.priority as number)) {
      addIssue(
        issues,
        "duplicate_entry",
        `${path}.priority`,
        `Duplicate state priority: ${String(state.priority)}`,
      );
    } else priorities.add(state.priority as number);
    enumValue(state.change, ACTION_POLICIES, `${path}.change`, issues);
    enumValue(state.commit, ACTION_POLICIES, `${path}.commit`, issues);
    enumValue(state.focus, ACTION_POLICIES, `${path}.focus`, issues);
  }
  if (!stateNames.has("ready")) {
    addIssue(issues, "missing_field", "$.states", "A ready state is required");
  }
  if (states.length !== Object.keys(FROZEN_STATES).length) {
    addIssue(
      issues,
      "invalid_value",
      "$.states",
      "The v1 finite state set must contain exactly five states",
    );
  }
  for (const [name, expected] of Object.entries(FROZEN_STATES)) {
    const state = statesByName.get(name);
    if (state === undefined) {
      addIssue(
        issues,
        "missing_field",
        "$.states",
        `Frozen state is missing: ${name}`,
      );
      continue;
    }
    for (const [field, value] of Object.entries(expected)) {
      if (state[field] !== value) {
        addIssue(
          issues,
          "invalid_value",
          `$.states.${name}.${field}`,
          `Frozen state ${name} requires ${field}=${String(value)}`,
        );
      }
    }
  }

  const aria = exactRecord(contract.aria, ARIA_FIELDS, "$.aria", issues);
  const expectedAria = {
    rootRole: "group",
    accessibleName: "label-element",
    labelRelation: "for-control",
    descriptionRelation: "aria-describedby",
    errorRelation: "aria-describedby",
    invalidRelation: "aria-invalid",
    busyRelation: "aria-busy",
  } as const;
  if (aria !== undefined) {
    for (const key of ARIA_FIELDS) {
      if (aria[key] !== expectedAria[key]) {
        addIssue(
          issues,
          "invalid_value",
          `$.aria.${key}`,
          `Expected ${expectedAria[key]}`,
        );
      }
    }
  }

  if (!Array.isArray(contract.keyboard) || contract.keyboard.length === 0) {
    addIssue(issues, "invalid_type", "$.keyboard", "Expected keyboard cases");
  } else {
    const cases = new Set<string>();
    const outcomes = new Map<string, unknown>();
    for (const [index, entry] of contract.keyboard.entries()) {
      const path = `$.keyboard[${index}]`;
      const item = exactRecord(entry, KEYBOARD_FIELDS, path, issues);
      if (item === undefined) continue;
      if (item.key !== "Enter" || item.when !== "control-focused") {
        addIssue(
          issues,
          "invalid_value",
          path,
          "Keyboard behavior is outside the v1 allowlist",
        );
      }
      if (typeof item.duringComposition !== "boolean") {
        addIssue(
          issues,
          "invalid_type",
          `${path}.duringComposition`,
          "Expected a boolean",
        );
      }
      if (item.outcome !== "commit-once" && item.outcome !== "no-commit") {
        addIssue(
          issues,
          "invalid_value",
          `${path}.outcome`,
          "Unknown keyboard outcome",
        );
      }
      const key = `${String(item.key)}/${String(item.duringComposition)}`;
      if (cases.has(key))
        addIssue(
          issues,
          "duplicate_entry",
          path,
          `Duplicate keyboard case: ${key}`,
        );
      cases.add(key);
      outcomes.set(key, item.outcome);
    }
    for (const requiredCase of ["Enter/false", "Enter/true"]) {
      if (!cases.has(requiredCase)) {
        addIssue(
          issues,
          "missing_field",
          "$.keyboard",
          `Missing keyboard case: ${requiredCase}`,
        );
      }
    }
    if (outcomes.get("Enter/false") !== "commit-once") {
      addIssue(
        issues,
        "invalid_value",
        "$.keyboard",
        "Enter outside composition must commit exactly once",
      );
    }
    if (outcomes.get("Enter/true") !== "no-commit") {
      addIssue(
        issues,
        "invalid_value",
        "$.keyboard",
        "Enter during composition must not commit",
      );
    }
  }

  if (!Array.isArray(contract.callbacks) || contract.callbacks.length === 0) {
    addIssue(issues, "invalid_type", "$.callbacks", "Expected callback cases");
  } else {
    const triggers = new Set<string>();
    const callbackOrders = new Map<string, readonly string[]>();
    for (const [index, entry] of contract.callbacks.entries()) {
      const path = `$.callbacks[${index}]`;
      const item = exactRecord(entry, CALLBACK_FIELDS, path, issues);
      if (item === undefined) continue;
      enumValue(item.trigger, ["change", "commit"], `${path}.trigger`, issues);
      if (typeof item.trigger === "string" && triggers.has(item.trigger)) {
        addIssue(
          issues,
          "duplicate_entry",
          `${path}.trigger`,
          `Duplicate callback trigger: ${item.trigger}`,
        );
      }
      if (typeof item.trigger === "string") triggers.add(item.trigger);
      const order = stringArray(
        item.order,
        `${path}.order`,
        issues,
        IDENTIFIER_PATTERN,
      );
      if (typeof item.trigger === "string") {
        callbackOrders.set(item.trigger, order);
      }
      for (const callback of order) {
        if (!callbackProps.has(callback)) {
          addIssue(
            issues,
            "invalid_value",
            `${path}.order`,
            `Callback order references a non-callback prop: ${callback}`,
          );
        }
      }
      if (item.callsPerEvent !== 1) {
        addIssue(
          issues,
          "invalid_value",
          `${path}.callsPerEvent`,
          "Callbacks must fire exactly once per event",
        );
      }
    }
    for (const requiredTrigger of ["change", "commit"]) {
      if (!triggers.has(requiredTrigger)) {
        addIssue(
          issues,
          "missing_field",
          "$.callbacks",
          `Missing callback trigger: ${requiredTrigger}`,
        );
      }
    }
    const expectedChangeOrder =
      control !== undefined && typeof control.changeCallback === "string"
        ? [control.changeCallback, "onEvent"]
        : [];
    const frozenOrders = new Map<string, readonly string[]>([
      ["change", expectedChangeOrder],
      ["commit", ["onCommit", "onEvent"]],
    ]);
    for (const [trigger, expectedOrder] of frozenOrders) {
      const actualOrder = callbackOrders.get(trigger);
      if (
        actualOrder === undefined ||
        actualOrder.length !== expectedOrder.length ||
        actualOrder.some((entry, index) => entry !== expectedOrder[index])
      ) {
        addIssue(
          issues,
          "invalid_value",
          `$.callbacks.${trigger}.order`,
          `Frozen ${trigger} callback order is ${expectedOrder.join(" then ")}`,
        );
      }
    }
  }

  const portal = exactRecord(
    contract.portal,
    PORTAL_FIELDS,
    "$.portal",
    issues,
  );
  if (
    portal !== undefined &&
    (portal.mode !== "none" ||
      portal.themeInheritance !== "same-dom-tree" ||
      portal.layer !== "artemis.ui")
  ) {
    addIssue(
      issues,
      "invalid_value",
      "$.portal",
      "Probe portals and detached theme roots are forbidden",
    );
  }

  const theme = exactRecord(contract.theme, THEME_FIELDS, "$.theme", issues);
  if (theme !== undefined) {
    if (
      theme.direction !== "inherit" ||
      theme.reducedMotion !== "disable-transitions"
    ) {
      addIssue(
        issues,
        "invalid_value",
        "$.theme",
        "Direction must inherit and reduced motion must disable transitions",
      );
    }
    stringArray(
      theme.mutableTokens,
      "$.theme.mutableTokens",
      issues,
      TOKEN_PATTERN,
    );
    const safety = stringArray(
      theme.safetyFloor,
      "$.theme.safetyFloor",
      issues,
    );
    if (
      safety.length !== SAFETY_FLOOR.length ||
      SAFETY_FLOOR.some((entry) => !safety.includes(entry))
    ) {
      addIssue(
        issues,
        "invalid_value",
        "$.theme.safetyFloor",
        "The complete non-overridable safety floor is required",
      );
    }
  }

  if (issues.length > 0) return { valid: false, issues };
  return { valid: true, issues, value: input as ComponentContract };
}
