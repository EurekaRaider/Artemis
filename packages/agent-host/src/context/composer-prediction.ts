import type {
  Api,
  Context,
  ImageContent,
  Model,
  SimpleStreamOptions,
  TextContent,
} from "@earendil-works/pi-ai";
import type { ModelRuntime } from "@earendil-works/pi-coding-agent";
import {
  composerPredictionInstruction,
  stripComposerPrediction,
} from "@artemis/protocol";

/** Project text only at the provider boundary; never mutate signed Pi history. */
export function withoutComposerPredictions(
  messages: Context["messages"],
): Context["messages"] {
  const tokens = new Set<string>();
  return messages.map((message) => {
    if (message.role === "user") {
      const text =
        typeof message.content === "string"
          ? message.content
          : message.content
              .filter((part) => part.type === "text")
              .map((part) => part.text)
              .join("\n");
      for (const match of text.matchAll(
        /\[Artemis composer prediction ([a-zA-Z0-9-]{1,80})\]/gu,
      ))
        tokens.add(match[1]!);
      // Only the host's active turn may enable predictions, never transcript history.
      const clean = (value: string) =>
        value.replace(
          /\n*\[Artemis composer prediction [a-zA-Z0-9-]{1,80}\][\s\S]*?\[End Artemis composer prediction\]\n?/gu,
          "",
        );
      return {
        ...message,
        content:
          typeof message.content === "string"
            ? clean(message.content)
            : message.content.flatMap<TextContent | ImageContent>((part) => {
                if (part.type !== "text") return [part];
                const text = clean(part.text);
                return !text && part.text ? [] : [{ ...part, text }];
              }),
      };
    }
    if (message.role !== "assistant" || !tokens.size) return message;
    return {
      ...message,
      content: message.content.map((part) => {
        if (part.type !== "text") return part;
        let text = part.text;
        for (const token of tokens) text = stripComposerPrediction(text, token);
        return text === part.text ? part : { ...part, text };
      }),
    };
  });
}

export function withComposerPredictionContext(
  runtime: ModelRuntime,
  predictionTokenForSession: (
    sessionId: string | undefined,
  ) => string | undefined,
): ModelRuntime {
  return new Proxy(runtime, {
    get(target, property) {
      if (property === "streamSimple")
        return (
          model: Model<Api>,
          context: Context,
          options?: SimpleStreamOptions,
        ) => {
          const messages = withoutComposerPredictions(context.messages);
          const token = predictionTokenForSession(options?.sessionId);
          const latestUser = messages.findLastIndex(
            (message) => message.role === "user",
          );
          const message = messages[latestUser];
          if (token && message?.role === "user") {
            const instruction = composerPredictionInstruction(token);
            messages[latestUser] = {
              ...message,
              content:
                typeof message.content === "string"
                  ? message.content + instruction
                  : [...message.content, { type: "text", text: instruction }],
            };
          }
          return target.streamSimple(
            model,
            {
              ...context,
              messages,
            },
            options,
          );
        };
      const value = Reflect.get(target, property, target) as unknown;
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}
