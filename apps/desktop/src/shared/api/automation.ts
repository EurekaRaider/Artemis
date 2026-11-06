import type {
  Automation,
  AutomationRun,
  AutomationSchedule,
  AutomationTarget,
  RunMode,
} from "@artemis/protocol";
import type { ModelSelection } from "@artemis/protocol";

export interface AutomationApi {
  listAutomations(projectId?: string): Promise<Automation[]>;
  listAutomationRuns(
    automationId: string,
    limit?: number,
  ): Promise<AutomationRun[]>;
  saveAutomation(input: SaveAutomationInput): Promise<Automation>;
  setAutomationEnabled(id: string, enabled: boolean): Promise<Automation>;
  authorizeAutomation(id: string): Promise<Automation | undefined>;
  deleteAutomation(id: string): Promise<void>;
  runAutomationNow(id: string): Promise<AutomationRun>;
}

export interface SaveAutomationInput {
  id?: string;
  projectId: string;
  name: string;
  prompt: string;
  mode: RunMode;
  target: AutomationTarget;
  modelSelection?: ModelSelection;
  schedule: AutomationSchedule;
  enabled: boolean;
}
