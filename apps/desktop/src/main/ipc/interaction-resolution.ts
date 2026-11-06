import type {
  ApprovalResolution,
  UserInputResolution,
} from "@artemis/protocol";
import {
  approvalResolutionSchema,
  userInputResolutionSchema,
} from "@artemis/protocol";
import { IPC } from "../../shared/api.js";
import type { ApplicationServices } from "../application/application-services.js";
type Dependencies = Pick<
  ApplicationServices,
  | "resolveApproval"
  | "ipcMain"
  | "completeMultiUserInputQuestion"
  | "isMultiQuestionUserInputResolution"
  | "completeUserInput"
>;

export function registerInteractionResolutionIpc(services: Dependencies): void {
  const {
    resolveApproval,
    ipcMain,
    completeMultiUserInputQuestion,
    isMultiQuestionUserInputResolution,
    completeUserInput,
  } = services;

  ipcMain.handle(
    IPC.approvalResolve,
    (_event, resolution: ApprovalResolution) =>
      resolveApproval(approvalResolutionSchema.parse(resolution)),
  );

  ipcMain.handle(
    IPC.userInputResolve,
    (_event, resolution: UserInputResolution) => {
      const parsed = userInputResolutionSchema.parse(resolution);
      // Fail-closed semantics are unchanged: a malformed resolution of
      // either form throws in parse and the invoke rejects, and
      // completeMultiUserInputQuestion re-throws for unknown or
      // already-answered questions, so duplicate submits stay rejected.
      if (isMultiQuestionUserInputResolution(parsed)) {
        completeMultiUserInputQuestion(
          parsed.requestId,
          parsed.nonce,
          parsed.questionId,
          "user",
          parsed.skipped
            ? { skipped: true }
            : parsed.customAnswer !== undefined
              ? { customAnswer: parsed.customAnswer }
              : parsed.selectedOptionLabel !== undefined
                ? { selectedOptionLabel: parsed.selectedOptionLabel }
                : {},
        );
        return;
      }
      completeUserInput(parsed, "user");
    },
  );
}
