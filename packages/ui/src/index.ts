export const UI_CONTRACT_VERSION = 1 as const;

export interface ArtemisUiRootAttributes {
  readonly "data-artemis-skin": string;
  readonly "data-artemis-theme": "light" | "dark";
  readonly "data-artemis-contrast": "normal" | "high";
}

export const ARTEMIS_UI_ROOT_ATTRIBUTE_NAMES = [
  "data-artemis-skin",
  "data-artemis-theme",
  "data-artemis-contrast",
] as const satisfies readonly (keyof ArtemisUiRootAttributes)[];

export {
  COMPONENT_CONTRACT_SCHEMA_VERSION,
  validateComponentContract,
} from "./component-contract.js";
export type {
  ComponentContract,
  ComponentContractIssue,
  ComponentContractReport,
} from "./component-contract.js";
