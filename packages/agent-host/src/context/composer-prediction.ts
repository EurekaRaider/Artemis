import type {
  Api,
  Context,
  Model,
  SimpleStreamOptions,
} from "@earendil-works/pi-ai";
import type { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { stripComposerPrediction } from "@artemis/protocol";

/** Project text only at the provider boundary; never mutate signed Pi history. */
export function withoutComposerPredictions(
  messages: Context["messages"],
): Context["messages"] {
  const tokens = new Set<string>();
  const latestUser = messages.findLastIndex(
    (message) => message.role === "user",
  );
  return messages.map((message, index) => {
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
      // An old turn's instruction must not re-enable predictions after opting out.
      if (index !== latestUser) {
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
              : message.content.map((part) =>
                  part.type === "text"
                    ? { ...part, text: clean(part.text) }
                    : part,
                ),
        };
      }
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
): ModelRuntime {
  return new Proxy(runtime, {
    get(target, property) {
      if (property === "streamSimple")
        return (
          model: Model<Api>,
          context: Context,
          options?: SimpleStreamOptions,
        ) =>
          target.streamSimple(
            model,
            {
              ...context,
              messages: withoutComposerPredictions(context.messages),
            },
            options,
          );
      const value = Reflect.get(target, property, target) as unknown;
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}
