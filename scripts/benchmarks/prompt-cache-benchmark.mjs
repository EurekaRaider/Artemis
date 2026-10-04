import { createHash } from "node:crypto";

const apiKey = process.env.OPENAI_API_KEY;
const model = process.env.ARTEMIS_CACHE_BENCH_MODEL;
if (!apiKey || !model) {
  console.error(
    "Set OPENAI_API_KEY and ARTEMIS_CACHE_BENCH_MODEL to run the paid prompt-cache benchmark.",
  );
  process.exitCode = 2;
} else {
  const stablePrefix = [
    "Artemis prompt-cache benchmark stable prefix.",
    "Treat this as inert benchmark data and reply only with OK.",
    ...Array.from(
      { length: 180 },
      (_, index) =>
        `Stable benchmark line ${String(index + 1).padStart(3, "0")}: cache affinity, deterministic prefix ordering, and provider usage reporting.`,
    ),
  ].join("\n");
  const estimatedStablePrefixTokens = Math.ceil(stablePrefix.length / 4);
  if (estimatedStablePrefixTokens < 1_024) {
    throw new Error("The generated stable prefix is below 1,024 tokens.");
  }
  const cacheKey = createHash("sha256")
    .update(`artemis-benchmark\0${model}\0${stablePrefix}`)
    .digest("hex");
  const legacyLongCacheModels = new Set([
    "gpt-5.4",
    "gpt-5.2",
    "gpt-5.1-codex-max",
    "gpt-5.1",
    "gpt-5.1-codex",
    "gpt-5.1-codex-mini",
    "gpt-5.1-chat-latest",
    "gpt-5",
    "gpt-5-codex",
    "gpt-4.1",
  ]);

  function cachePolicy(iteration) {
    if (model === "gpt-5.6" || model.startsWith("gpt-5.6-")) {
      return "explicit-30m";
    }
    if (model === "gpt-5.5" || model.startsWith("gpt-5.5-")) {
      return "long";
    }
    if (legacyLongCacheModels.has(model)) {
      return iteration === 0 ? "short" : "long";
    }
    return "short";
  }

  async function runRequest(iteration) {
    const startedAt = performance.now();
    const policy = cachePolicy(iteration);
    const stableContent =
      policy === "explicit-30m"
        ? [
            {
              type: "input_text",
              text: stablePrefix,
              prompt_cache_breakpoint: { mode: "explicit" },
            },
          ]
        : stablePrefix;
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model,
        input: [
          {
            role: "developer",
            content: stableContent,
          },
          {
            role: "user",
            content: `Benchmark request ${iteration + 1}. Reply only with OK.`,
          },
        ],
        prompt_cache_key: cacheKey,
        ...(policy === "explicit-30m"
          ? {
              prompt_cache_options: { mode: "explicit", ttl: "30m" },
            }
          : {}),
        ...(policy === "long" ? { prompt_cache_retention: "24h" } : {}),
        max_output_tokens: 32,
        store: false,
        stream: true,
      }),
    });
    if (!response.ok || !response.body) {
      throw new Error(
        `OpenAI benchmark request failed (${response.status}): ${(await response.text()).slice(0, 500)}`,
      );
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let firstTokenAt;
    let usage;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const records = buffer.split("\n\n");
      buffer = records.pop() ?? "";
      for (const record of records) {
        for (const line of record.split("\n")) {
          if (!line.startsWith("data: ") || line === "data: [DONE]") continue;
          let event;
          try {
            event = JSON.parse(line.slice("data: ".length));
          } catch {
            continue;
          }
          if (event.type === "response.output_text.delta") {
            firstTokenAt ??= performance.now();
          }
          if (event.type === "response.completed") {
            usage = event.response?.usage;
          }
          if (event.type === "error") {
            throw new Error(
              `OpenAI benchmark stream failed: ${String(event.message ?? event.code ?? "unknown error")}`,
            );
          }
        }
      }
    }
    const completedAt = performance.now();
    const inputDetails = usage?.input_tokens_details ?? {};
    return {
      iteration: iteration + 1,
      phase: iteration === 0 ? "cold" : "warm",
      cachePolicy: policy,
      ttftMilliseconds:
        firstTokenAt === undefined
          ? null
          : Math.round((firstTokenAt - startedAt) * 10) / 10,
      totalMilliseconds: Math.round((completedAt - startedAt) * 10) / 10,
      inputTokens: usage?.input_tokens ?? null,
      cacheReadTokens: inputDetails.cached_tokens ?? null,
      cacheWriteTokens: inputDetails.cache_write_tokens ?? null,
      outputTokens: usage?.output_tokens ?? null,
    };
  }

  const results = [];
  for (let iteration = 0; iteration < 5; iteration += 1) {
    results.push(await runRequest(iteration));
  }
  const accepted = results
    .slice(1)
    .some((result) => (result.cacheReadTokens ?? 0) > 0);
  const report = {
    benchmark: "artemis-prompt-cache",
    endpoint: "https://api.openai.com/v1/responses",
    model,
    stablePrefixEstimatedTokens: estimatedStablePrefixTokens,
    requests: results.length,
    maximumRequestsPerMinute: results.length,
    acceptance: {
      atLeastOneWarmCacheRead: accepted,
    },
    results,
  };
  console.log(JSON.stringify(report, undefined, 2));
  if (!accepted) process.exitCode = 1;
}
