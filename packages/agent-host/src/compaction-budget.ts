import {
  createAssistantMessageEventStream,
  type AssistantMessage,
  type Context,
} from "@earendil-works/pi-ai";
import { isContextOverflow } from "@earendil-works/pi-ai/compat";
import type { AgentSession } from "@earendil-works/pi-coding-agent";
import {
  estimateRequestTokens,
  inputTokenLimit,
} from "./attachment-context.js";

type StreamFunction = AgentSession["agent"]["streamFunction"];
const installed = new WeakSet<AgentSession>();

export function installCompactionBudget(session: AgentSession): void {
  if (installed.has(session)) return;
  installed.add(session);
  const stream = session.agent.streamFunction;
  const compact = withCompactionBudget(stream);
  session.agent.streamFunction = (model, context, options) =>
    session.isCompacting
      ? compact(model, context, options)
      : stream(model, context, options);
}

/** Bound Pi's summary requests without replacing its compaction or persistence lifecycle. */
export function withCompactionBudget(stream: StreamFunction): StreamFunction {
  return async (model, context, options) => {
    let usage: AssistantMessage["usage"] | undefined;
    const call = async (request: Context, maxTokens = options?.maxTokens) => {
      options?.signal?.throwIfAborted();
      const response = await (
        await stream(model, request, {
          ...options,
          ...(maxTokens === undefined ? {} : { maxTokens }),
        })
      ).result();
      options?.signal?.throwIfAborted();
      if (!usage) usage = structuredClone(response.usage);
      else {
        for (const key of [
          "input",
          "output",
          "cacheRead",
          "cacheWrite",
          "totalTokens",
        ] as const) {
          usage[key] += response.usage[key];
        }
        for (const key of [
          "input",
          "output",
          "cacheRead",
          "cacheWrite",
          "total",
        ] as const) {
          usage.cost[key] += response.usage.cost[key];
        }
      }
      return response;
    };
    const requireSummary = (response: AssistantMessage): string => {
      if (
        response.stopReason !== "stop" ||
        response.content.some((block) => block.type === "toolCall")
      ) {
        throw new Error(
          `${response.errorMessage ?? "The summary was incomplete."} Original history is unchanged.`,
        );
      }
      const text = response.content
        .filter((block) => block.type === "text")
        .map((block) => block.text)
        .join("\n");
      if (!text.trim())
        throw new Error(
          "Context compaction returned an empty summary. Original history is unchanged.",
        );
      return text;
    };
    const finish = (response: AssistantMessage) => {
      const result = createAssistantMessageEventStream();
      if (
        response.stopReason === "error" ||
        response.stopReason === "aborted"
      ) {
        // Preserve Pi's retryAssistantCall handling of transient provider errors.
        result.push({
          type: "error",
          reason: response.stopReason,
          error: { ...response, usage: usage! },
        });
      } else {
        requireSummary(response);
        result.push({
          type: "done",
          reason: "stop",
          message: { ...response, usage: usage! },
        });
      }
      return result;
    };
    const limit = inputTokenLimit(model, options?.maxTokens);
    let request = context;
    // Each pass must shrink the summary request. Bound recovery even if a provider
    // repeatedly rejects requests or returns summaries that are too large.
    for (let pass = 0; pass < 4; pass++) {
      options?.signal?.throwIfAborted();
      if (estimateRequestTokens(model, request) <= limit) {
        const response = await call(request);
        if (!isContextOverflow(response, model.contextWindow)) {
          return finish(response);
        }
      }

      // Pi 0.85 serializes summary inputs into one text message. Preserve its
      // exact summary instructions (including custom focus and previous summary).
      const message = request.messages[0];
      const text =
        message &&
        typeof message.content !== "string" &&
        message.content.length === 1 &&
        message.content[0]?.type === "text"
          ? message.content[0].text
          : undefined;
      const end = text?.lastIndexOf("</conversation>") ?? -1;
      if (
        request.messages.length !== 1 ||
        !text?.startsWith("<conversation>\n") ||
        end < 0
      ) {
        throw new Error(
          "Context compaction request is too large to split safely. Select a larger-context model. Original history is unchanged.",
        );
      }
      const body = text.slice("<conversation>\n".length, end);
      const suffix = text.slice(end);
      const withBody = (value: string): Context => ({
        ...request,
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: `<conversation>\n${value}${suffix}` },
            ],
            timestamp: message!.timestamp,
          },
        ],
      });
      const fixed = estimateRequestTokens(model, withBody(""));
      const chunkTokens = Math.floor((limit - fixed - 256) / 2 ** (pass + 1));
      if (chunkTokens < 256) {
        throw new Error(
          "Context compaction instructions exceed the available input budget. Shorten the compaction instructions or select a larger-context model. Original history is unchanged.",
        );
      }
      const summaries: string[] = [];
      let chunkSize = chunkTokens;
      let overflowSplits = 0;
      for (let offset = 0; offset < body.length;) {
        let endOffset = Math.min(body.length, offset + chunkSize * 4);
        // Prefer a serialized message/line boundary; split a single huge tool
        // result when necessary, without dropping text or cutting a surrogate pair.
        const newline = body.lastIndexOf("\n", endOffset - 1);
        if (newline > offset + chunkSize * 2) endOffset = newline + 1;
        if (
          endOffset < body.length &&
          /[\uD800-\uDBFF]/u.test(body[endOffset - 1]!)
        )
          endOffset--;
        const response = await call(
          withBody(body.slice(offset, endOffset)),
          Math.min(
            options?.maxTokens ?? model.maxTokens,
            Math.max(128, Math.floor(chunkSize / 4)),
          ),
        );
        if (
          isContextOverflow(response, model.contextWindow) &&
          overflowSplits < 4 &&
          chunkSize >= 512
        ) {
          chunkSize = Math.floor(chunkSize / 2);
          overflowSplits++;
          continue;
        }
        if (
          response.stopReason === "error" ||
          response.stopReason === "aborted"
        )
          return finish(response);
        summaries.push(requireSummary(response));
        offset = endOffset;
      }
      const reduced = withBody(summaries.join("\n\n"));
      if (
        estimateRequestTokens(model, reduced) >=
        estimateRequestTokens(model, request)
      ) {
        throw new Error(
          "Context compaction did not reduce the request size. Select a larger-context model. Original history is unchanged.",
        );
      }
      request = reduced;
    }
    throw new Error(
      "Context compaction could not fit the model window after bounded recovery. Select a larger-context model. Original history is unchanged.",
    );
  };
}
