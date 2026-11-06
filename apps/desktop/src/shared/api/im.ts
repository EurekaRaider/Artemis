import type { ImSettings, ImStatus, ImManagement } from "@artemis/protocol";

export interface ImApi {
  getImStatus(): Promise<
    ImStatus & { connections?: unknown[]; spaces?: unknown[] }
  >;
  saveImSettings(settings: ImSettings): Promise<ImStatus>;
  manageIm(input: ImManagement): Promise<unknown>;
}
