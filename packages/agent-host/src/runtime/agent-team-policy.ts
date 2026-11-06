import { relative } from "node:path";
import { resolveWorkspacePath } from "@artemis/platform";
import { type ChildAgentPayload } from "@artemis/protocol";
import {
  type AgentSessionEvent,
  type ChildAgentExecution,
} from "./runtime-types.js";
export const CHILD_MIN_SUSPECT_SILENCE_MILLISECONDS = 60_000;

export const CHILD_STALLED_SILENCE_MILLISECONDS = 5 * 60_000;

export const CHILD_CONTROL_OBSERVATION_MILLISECONDS = 5_000;

export const ROOT_AGENT_ID = "parent";

export function requestsInterruptedTeamContinuation(text: string): boolean {
  const request = text.trim();
  if (!request || request.length > 500) return false;
  if (
    /^(?:continue|resume|retry|restart|carry\s+on|pick\s+up)[.!?]*$/iu.test(
      request,
    ) ||
    /^(?:继续|接着|恢复|重试|续上|续做)[。！？.!?]*$/u.test(request)
  ) {
    return true;
  }
  const englishContinuation =
    /\b(?:continue|resume|retry|restart|carry\s+on|pick\s+up)\b/iu.test(
      request,
    ) &&
    /\b(?:previous|prior|interrupted|unfinished|team|task|work|where\s+we\s+left\s+off)\b/iu.test(
      request,
    );
  const chineseContinuation =
    /继续|接着|恢复|重试|续上|续做/u.test(request) &&
    /刚才|之前|上次|中断|未完成|团队|任务|工作|做完|完成/u.test(request);
  return englishContinuation || chineseContinuation;
}

export function terminalAgentStopReason(
  event: AgentSessionEvent,
): "error" | "aborted" | undefined {
  if (event.type !== "agent_end" || event.willRetry) return undefined;
  for (let index = event.messages.length - 1; index >= 0; index -= 1) {
    const message = event.messages[index];
    if (message?.role !== "assistant") continue;
    return message.stopReason === "error" || message.stopReason === "aborted"
      ? message.stopReason
      : undefined;
  }
  return undefined;
}

export function isTerminalChildStatus(
  status: ChildAgentPayload["status"],
): boolean {
  return (
    status === "completed" ||
    status === "failed" ||
    status === "blocked" ||
    status === "cancelled"
  );
}

export function isTerminalChildExecution(child: ChildAgentExecution): boolean {
  return isTerminalChildStatus(child.status);
}

export function normalizedWritePaths(
  workspacePath: string,
  paths: string[],
): string[] {
  const workspaceRoot = resolveWorkspacePath(workspacePath, ".");
  const normalized = paths.map((path) => {
    const absolute = resolveWorkspacePath(workspacePath, path);
    const candidate = relative(workspaceRoot, absolute).replaceAll("\\", "/");
    return candidate || ".";
  });
  return [...new Set(normalized)].sort();
}

export function writePathsOverlap(left: string, right: string): boolean {
  return (
    left === "." ||
    right === "." ||
    left === right ||
    left.startsWith(`${right}/`) ||
    right.startsWith(`${left}/`)
  );
}

export function writePathAllowed(writePaths: string[], path: string): boolean {
  return writePaths.some(
    (scope) => scope === "." || path === scope || path.startsWith(`${scope}/`),
  );
}
