import type { Api, Model } from "@earendil-works/pi-ai";
import {
  estimateRequestTokens,
  inputTokenLimit,
} from "./attachment-context.js";

/** Check the fully assembled first request against the resolved child model. */
export function assertCustomAgentContext(
  model: Model<Api>,
  context: Parameters<typeof estimateRequestTokens>[1],
): void {
  const estimatedTokens = estimateRequestTokens(model, context);
  const inputLimit = inputTokenLimit(model);
  if (estimatedTokens <= inputLimit) return;
  // This is an initial request: compacting empty history cannot shrink the
  // dedicated instructions. Fail once, before invoking the provider.
  throw new Error(
    `CUSTOM_AGENT_CONTEXT_EXCEEDED: ${model.provider}/${model.id} has a ${model.contextWindow}-token context window. The complete child input needs approximately ${estimatedTokens} tokens; ${inputLimit} input tokens remain after output and safety reserves. Shorten the dedicated instructions or task, load reference files on demand, or select a larger-context model. Saved instructions are unchanged.`,
  );
}
