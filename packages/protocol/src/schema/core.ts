import { z } from "zod";

// Multi-question user-input payloads evolved in place within v4 (the kind
// payload discriminant) instead of bumping the protocol version: no build
// that produces kind-ed payloads has shipped, so event logs containing them
// cannot exist and downgrades face zero exposure; conversely, a bump would
// not teach older builds to read the new payloads — it would only make new
// builds reject existing v4 logs.
export const PROTOCOL_VERSION = 4 as const;

export const runModeSchema = z.preprocess(
  (value) =>
    value === "execute" ? "work" : value === "review" ? "plan" : value,
  z.enum(["plan", "work", "codemode"]),
);

export type RunMode = z.infer<typeof runModeSchema>;

export function isExecutionMode(mode: unknown): mode is "work" | "codemode" {
  return mode === "work" || mode === "codemode";
}

export const approvalPolicySchema = z.enum([
  "ask",
  "agent",
  "full-access",
  "custom",
]);

export type ApprovalPolicy = z.infer<typeof approvalPolicySchema>;
