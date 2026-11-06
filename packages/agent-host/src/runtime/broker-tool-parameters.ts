import { Type } from "@sinclair/typebox";
import {
  type ModelApprovalDecision,
  type PromptAttachment,
  type PromptImage,
} from "@artemis/protocol";
import { type ObservedBashSnapshot } from "../tools/observed-bash.js";
import { type SessionImage } from "./runtime-types.js";
export const modelApprovalParameter = Type.Object(
  {
    risk: Type.Union(
      [Type.Literal("low"), Type.Literal("medium"), Type.Literal("high")],
      {
        description:
          "Classify the exact operation: low is read-only without external side effects; medium is scoped, reversible project or temporary-state change; high is destructive, security-sensitive, broad, privileged, sensitive-data access, or an external commitment.",
      },
    ),
    explicit_user_request: Type.Boolean({
      description:
        "Use true only when the user's current request directly and unambiguously authorizes this exact action and target. General goals, inferred steps, prior unrelated approvals, and scope changes are false.",
    }),
    reason: Type.String({
      minLength: 1,
      maxLength: 500,
      description: "Concise reason for the model's approval decision.",
    }),
  },
  { additionalProperties: false },
);

export const sandboxEscalationParameter = Type.Optional(
  Type.Object(
    {
      justification: Type.String({
        minLength: 1,
        maxLength: 2000,
        description:
          "Explain the observed local sandbox restriction, why desktop-user access is necessary for this exact user-authorized action, and why retrying this one call cannot duplicate uncertain side effects. This requests one unsandboxed call, not administrator/root access or a permanent permission change. Never use it for remote authorization errors or replay an entire Codemode script.",
      }),
    },
    { additionalProperties: false },
  ),
);

export function modelApproval(decision: {
  risk: ModelApprovalDecision["risk"];
  explicit_user_request: boolean;
  reason: string;
}): ModelApprovalDecision {
  const reason = decision.reason.trim();
  if (!reason) throw new Error("A model approval reason is required.");
  return {
    risk: decision.risk,
    explicitUserRequest: decision.explicit_user_request,
    reason,
  };
}

export function toSessionImages(
  attachments: PromptAttachment[] | undefined,
): SessionImage[] | undefined {
  const images =
    attachments?.filter(
      (attachment): attachment is PromptImage => !("type" in attachment),
    ) ?? [];
  if (images.length === 0) {
    return undefined;
  }
  return images.map((attachment) => ({
    type: "image",
    ...(attachment.attachmentId
      ? { attachmentId: attachment.attachmentId }
      : {}),
    data: attachment.data,
    mimeType: attachment.mimeType,
  }));
}

export function containsMemoryCredential(value: string): boolean {
  return (
    /-----BEGIN [A-Z ]*PRIVATE KEY-----/u.test(value) ||
    /\bAuthorization\s*:\s*Bearer\s+\S+/iu.test(value) ||
    /\b(?:api[_-]?key|password|secret|token)\s*[:=]\s*\S{8,}/iu.test(value) ||
    /\bsk-[a-z0-9_-]{16,}\b/iu.test(value)
  );
}

export function isTransientMemory(title: string, content: string): boolean {
  const value = `${title}\n${content}`;
  return (
    /\b(?:current|today(?:'s)?|this run|right now)\b[\s\S]{0,48}\b\d+\b/iu.test(
      value,
    ) ||
    /\b(?:test count|passing tests|failed tests|elapsed time)\b/iu.test(value)
  );
}

export function observedBashToolResult(snapshot: ObservedBashSnapshot) {
  return {
    content: [
      { type: "text" as const, text: JSON.stringify(snapshot, null, 2) },
    ],
    details: snapshot,
  };
}
