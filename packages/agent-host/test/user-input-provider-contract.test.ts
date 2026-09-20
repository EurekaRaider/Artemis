import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { BrokerExecutionRequest } from "@artemis/protocol";
import { normalizeContext, type Model, type Tool } from "@earendil-works/pi-ai";
import { streamSimple as streamCompletions } from "@earendil-works/pi-ai/api/openai-completions";
import { validateToolArguments } from "@earendil-works/pi-ai/utils/validation";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { ArtemisAgentHost } from "../src/runtime.js";
import { streamOpenAIResponsesWithAiSdk } from "../src/responses-ai-sdk-stream.js";

interface ExecutableTool extends Tool {
  execute(id: string, args: Record<string, unknown>): Promise<unknown>;
}

let workspace: string;
let host: ArtemisAgentHost;
let runtime: ModelRuntime;
let tool: ExecutableTool;
const requests: BrokerExecutionRequest[] = [];
const question = {
  question: " 希望使用哪种主题？ ",
  options: [
    { label: " 深色 ", description: " 使用深色背景。 ", recommended: true },
    { label: " 浅色 ", description: " 使用浅色背景。 " },
  ],
};

function validate(args: Record<string, unknown>) {
  return validateToolArguments(tool, {
    type: "toolCall",
    id: "input-call",
    name: tool.name,
    arguments: args,
  });
}

beforeAll(async () => {
  workspace = await mkdtemp(join(tmpdir(), "artemis-input-contract-"));
  host = new ArtemisAgentHost(
    {
      async request(request) {
        requests.push(request);
        return { approved: true, data: { source: "user" } };
      },
    },
    { emit() {} },
    { agentDir: join(workspace, "agent") },
  );
  await host.openThread({
    threadId: "input-contract",
    workspacePath: workspace,
    target: "local",
  });
  const thread = (
    host as unknown as {
      threads: Map<
        string,
        {
          delegatedTools: ExecutableTool[];
          currentTurnId: string;
          currentMode: string;
        }
      >;
    }
  ).threads.get("input-contract")!;
  thread.currentTurnId = "turn-1";
  thread.currentMode = "plan";
  tool = thread.delegatedTools.find(
    (item) => item.name === "request_user_input",
  )!;
  runtime = await ModelRuntime.create({
    allowModelNetwork: false,
    refreshOnCreate: false,
    credentials: {
      async read() {
        return undefined;
      },
      async list() {
        return [];
      },
      async modify() {
        throw new Error("No credential writes in contract tests.");
      },
    },
  });
});

afterEach(() => {
  requests.length = 0;
  vi.unstubAllGlobals();
});

afterAll(async () => {
  host?.dispose();
  if (workspace) await rm(workspace, { recursive: true, force: true });
});

describe("request_user_input parameter compatibility", () => {
  it("publishes one object shape without model-owned question ids", () => {
    const schema = JSON.parse(JSON.stringify(tool.parameters));
    expect(schema.type).toBe("object");
    expect(schema).not.toHaveProperty("anyOf");
    expect(schema.required).toEqual(["header", "questions"]);
    expect(schema.properties.questions).toMatchObject({
      minItems: 1,
      maxItems: 3,
    });
    const item = schema.properties.questions.items;
    expect(item.required).toEqual(["question", "options"]);
    expect(item.properties).not.toHaveProperty("questionId");
    expect(item.properties.options.items.required).toEqual([
      "label",
      "description",
    ]);
  });

  it("routes one question to the existing single-question broker shape", async () => {
    const args = { header: " 偏好 ", questions: [question] };
    await tool.execute("single", validate(args));
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      kind: "user.input",
      header: "偏好",
      question: "希望使用哪种主题？",
      options: [
        { label: "深色", description: "使用深色背景。", recommended: true },
        { label: "浅色", description: "使用浅色背景。", recommended: false },
      ],
    });
    expect(requests[0]).not.toHaveProperty("questions");
    expect(args.questions[0]!.options[1]).not.toHaveProperty("recommended");
  });

  it("assigns stable local ids for three sequential single-choice questions", async () => {
    const args = {
      header: "偏好",
      questions: [
        question,
        { ...question, question: "布局？" },
        { ...question, question: "字体？" },
      ],
    };
    await tool.execute("multiple", validate(args));
    expect(requests[0]).toMatchObject({
      kind: "user.input",
      questions: [
        { questionId: "q1", question: "希望使用哪种主题？" },
        { questionId: "q2", question: "布局？" },
        { questionId: "q3", question: "字体？" },
      ],
    });
    expect(requests[0]).not.toHaveProperty("question");
  });

  it.each([
    {},
    { header: "偏好", questions: [] },
    { header: "偏好", questions: Array.from({ length: 4 }, () => question) },
    { header: "偏好", questions: [{ options: question.options }] },
    {
      header: "偏好",
      questions: [{ ...question, options: question.options.slice(0, 1) }],
    },
    {
      header: "偏好",
      questions: [
        {
          ...question,
          options: Array.from({ length: 4 }, () => question.options[0]),
        },
      ],
    },
    {
      header: "偏好",
      questions: [{ ...question, options: [{ label: "A" }, { label: "B" }] }],
    },
  ])("rejects malformed arguments before showing a card: %j", (args) => {
    expect(() => validate(args)).toThrow(/Validation failed/);
    expect(requests).toHaveLength(0);
  });

  it.each([0, 2])(
    "does not invent a recommendation when %i options are marked",
    async (count) => {
      const args = {
        header: "偏好",
        questions: [
          {
            ...question,
            options: question.options.map((option, index) => ({
              ...option,
              recommended: index < count,
            })),
          },
        ],
      };
      await expect(tool.execute("invalid", validate(args))).rejects.toThrow(
        /exactly one recommendation/,
      );
      expect(requests).toHaveLength(0);
    },
  );

  it("replays recorded synthetic GLM, K3, DeepSeek and Gemini arguments through the host", async () => {
    // Arguments only from the controlled diagnostic; no credentials or user data.
    const fixtures = JSON.parse(
      await readFile(
        new URL(
          "./fixtures/user-input-provider-arguments.json",
          import.meta.url,
        ),
        "utf8",
      ),
    ) as Array<{ provider: string; arguments: Record<string, unknown> }>;
    for (const fixture of fixtures) {
      await tool.execute(fixture.provider, validate(fixture.arguments));
      expect(requests.at(-1), fixture.provider).toMatchObject({
        kind: "user.input",
        questions: [
          { questionId: "q1" },
          { questionId: "q2" },
          { questionId: "q3" },
        ],
      });
      const request = requests.at(-1)!;
      if (request.kind !== "user.input" || !("questions" in request))
        throw new Error("Missing questions");
      for (const item of request.questions!) {
        expect(
          item.options.every(
            (option) => typeof option.recommended === "boolean",
          ),
        ).toBe(true);
      }
    }
  });
});

function findSchemas(value: unknown): Record<string, unknown>[] {
  if (!value || typeof value !== "object") return [];
  const record = value as Record<string, unknown>;
  if (record.name === tool.name) {
    const schema =
      record.parameters ??
      record.input_schema ??
      record.parametersJsonSchema ??
      (record.inputSchema as { json?: unknown } | undefined)?.json;
    if (schema && typeof schema === "object")
      return [schema as Record<string, unknown>];
  }
  return Object.values(record).flatMap(findSchemas);
}

describe("request_user_input provider wire contracts without API keys", () => {
  it("preserves the schema through Artemis's custom Responses transport", async () => {
    let payload: unknown;
    const fetch = vi.fn(async (_url: unknown, init?: RequestInit) => {
      payload = JSON.parse(String(init?.body));
      return new Response(
        JSON.stringify({ error: { message: "OFFLINE_CAPTURE_COMPLETE" } }),
        { status: 400, headers: { "content-type": "application/json" } },
      );
    });
    vi.stubGlobal("fetch", fetch);
    const model = runtime
      .getModels()
      .find((item) => item.api === "openai-responses")!;
    await streamOpenAIResponsesWithAiSdk(
      model,
      normalizeContext({
        messages: [
          {
            role: "user",
            content: "Ask about an interface preference.",
            timestamp: 0,
          },
        ],
        tools: [tool],
      }),
      { apiKey: "offline-placeholder" },
    ).result();
    const schemas = findSchemas(payload);
    expect(schemas).toHaveLength(1);
    expect(schemas[0]).toMatchObject({
      type: "object",
      required: ["header", "questions"],
      properties: JSON.parse(JSON.stringify(tool.parameters)).properties,
    });
    expect(schemas[0]).not.toHaveProperty("anyOf");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it.each([
    "openai-completions",
    "openai-responses",
    "anthropic-messages",
    "google-generative-ai",
    "bedrock-converse-stream",
  ] as const)(
    "preserves the object schema in the actual %s adapter",
    async (api) => {
      const network = vi.fn(() => {
        throw new Error("Network forbidden in contract tests.");
      });
      vi.stubGlobal("fetch", network);
      const model = runtime.getModels().find((item) => item.api === api)!;
      expect(model).toBeDefined();
      const { streamSimple } = await import(`@earendil-works/pi-ai/api/${api}`);
      let payload: unknown;
      const result = await streamSimple(
        model,
        normalizeContext({
          messages: [
            {
              role: "user",
              content: "Ask about an interface preference.",
              timestamp: 0,
            },
          ],
          tools: [tool],
        }),
        {
          apiKey: "offline-placeholder",
          maxTokens: 2048,
          maxRetries: 0,
          env: {
            AWS_ACCESS_KEY_ID: "offline-placeholder",
            AWS_SECRET_ACCESS_KEY: "offline-placeholder",
            AWS_REGION: "us-east-1",
          },
          onPayload(value: unknown) {
            payload = value;
            throw new Error("OFFLINE_CAPTURE_COMPLETE");
          },
        },
      ).result();
      expect(payload, result.errorMessage).toBeDefined();
      const schemas = findSchemas(payload);
      expect(schemas).toHaveLength(1);
      expect(schemas[0]).toMatchObject({
        type: "object",
        required: ["header", "questions"],
        properties: JSON.parse(JSON.stringify(tool.parameters)).properties,
      });
      expect(schemas[0]).not.toHaveProperty("anyOf");
      expect(network).not.toHaveBeenCalled();
    },
  );

  it.each(["structured", "empty"])(
    "preserves %s arguments in split Chinese JSON stream chunks",
    async (kind) => {
      const args =
        kind === "empty" ? {} : { header: "偏好", questions: [question] };
      const chunks = [
        {
          choices: [
            {
              index: 0,
              delta: {
                role: "assistant",
                tool_calls: [
                  {
                    index: 0,
                    id: "call_test",
                    type: "function",
                    function: { name: tool.name, arguments: "" },
                  },
                ],
              },
            },
          ],
        },
        ...JSON.stringify(args)
          .match(/.{1,12}/gu)!
          .map((part) => ({
            choices: [
              {
                index: 0,
                delta: {
                  tool_calls: [{ index: 0, function: { arguments: part } }],
                },
              },
            ],
          })),
        { choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] },
      ];
      const fetch = vi.fn(
        async () =>
          new Response(
            chunks
              .map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`)
              .join("") + "data: [DONE]\n\n",
            { headers: { "content-type": "text/event-stream" } },
          ),
      );
      vi.stubGlobal("fetch", fetch);
      const model = runtime
        .getModels()
        .find(
          (item) => item.provider === "zai-coding-cn" && item.id === "glm-5.3",
        ) as Model<"openai-completions">;
      expect(model).toBeDefined();
      const result = await streamCompletions(
        model,
        normalizeContext({
          messages: [
            { role: "user", content: "请询问界面主题。", timestamp: 0 },
          ],
          tools: [tool],
        }),
        { apiKey: "offline-placeholder", maxRetries: 0, fetch },
      ).result();
      expect(result.stopReason, result.errorMessage).toBe("toolUse");
      const call = result.content.find((part) => part.type === "toolCall")!;
      expect(call.arguments).toEqual(args);
      if (kind === "empty") {
        expect(() => validateToolArguments(tool, call)).toThrow(
          /Validation failed/,
        );
      } else {
        await tool.execute(call.id, validateToolArguments(tool, call));
        expect(requests[0]).toMatchObject({
          kind: "user.input",
          question: "希望使用哪种主题？",
        });
      }
      expect(fetch).toHaveBeenCalledTimes(1);
    },
  );
});
