import { describe, expect, it } from "vitest";

import { createResourceOverrides } from "../src/resource-overrides.js";

describe("agent resource overrides", () => {
  it("identifies the assistant as Artemis without replacing other instructions", () => {
    const overrides = createResourceOverrides({ credentials: {} });
    const existingPrompt = "Follow the active project instructions.";

    const prompts = overrides.appendSystemPromptOverride?.([existingPrompt]);

    expect(prompts?.[0]).toBe(existingPrompt);
    expect(prompts?.at(-1)).toContain("You are Artemis");
    expect(prompts?.at(-1)).toContain(
      "a local desktop Agent for software development and everyday work",
    );
    expect(prompts?.at(-1)).toContain(
      "coding, research, documents, connected services, and recurring work",
    );
    expect(prompts?.at(-1)).toContain(
      "Do not present Artemis as only a coding or programming assistant",
    );
    expect(prompts?.at(-1)).not.toContain("the AI coding assistant");
    expect(prompts?.at(-1)).toContain('"Who are you?", "你是谁？"');
    expect(prompts?.at(-1)).toContain("Do not identify yourself as Pi");
    expect(prompts?.at(-1)).toContain(
      "Every file you create for the user must be linked",
    );
    expect(prompts?.at(-1)).toContain("[report.md](reports/report.md)");
    expect(prompts?.at(-1)).toContain(
      "[security.md (line 1)](docs/security.md:1)",
    );
    expect(prompts?.at(-1)).toContain("The desktop adds the file-type icon");
    expect(prompts?.at(-1)).toContain("Do not use file:// URLs");
    expect(prompts?.at(-1)).toContain(
      "call request_user_input instead of printing questions",
    );
    expect(prompts?.at(-1)).toContain("exactly one question per call");
    expect(prompts?.at(-1)).toContain("after five minutes");
    expect(prompts?.at(-1)).toContain("For tools that require model_approval");
    expect(prompts?.at(-1)).toContain("call update_plan");
    expect(prompts?.at(-1)).toContain("call save_memory");
    expect(prompts?.at(-1)).toContain("Agent-team coordination");
  });

  it("keeps parent-only tool rules out of child system prompts", () => {
    const overrides = createResourceOverrides({ credentials: {} }, "child");
    const prompt = overrides.appendSystemPromptOverride?.([]).at(-1);

    expect(prompt).toContain("Child-agent coordination");
    expect(prompt).not.toContain("call request_user_input");
    expect(prompt).not.toContain("call update_plan");
    expect(prompt).not.toContain("call save_memory");
    expect(prompt).not.toContain("call finish_team");
    expect(prompt).toContain(
      "A supervisor assignment is not itself an explicit user request",
    );
  });

  it("reports the configured provider and model instead of a pretrained identity", () => {
    let configuration = {
      credentials: {},
      providers: [
        {
          id: "local-proxy",
          name: "Acme Gateway",
          baseUrl: "http://127.0.0.1:11434/v1",
          models: [
            {
              id: "qwen-coder",
              name: "Qwen Coder",
              reasoning: false,
              input: ["text" as const],
              contextWindow: 128_000,
              maxTokens: 32_000,
            },
          ],
        },
      ],
      selection: {
        providerId: "local-proxy",
        modelId: "qwen-coder",
        thinkingLevel: "off" as const,
      },
    };
    const overrides = createResourceOverrides(() => configuration);

    const initialPrompt = overrides.appendSystemPromptOverride?.([]).at(-1);
    expect(initialPrompt).toContain(
      'provider "Acme Gateway" (ID: "local-proxy")',
    );
    expect(initialPrompt).toContain('model "Qwen Coder" (ID: "qwen-coder")');
    expect(initialPrompt).toContain("do not claim the backend is Claude");

    configuration = {
      ...configuration,
      providers: [
        {
          ...configuration.providers[0]!,
          models: [
            {
              ...configuration.providers[0]!.models[0]!,
              id: "deepseek-coder",
              name: "DeepSeek Coder",
            },
          ],
        },
      ],
      selection: {
        ...configuration.selection,
        modelId: "deepseek-coder",
      },
    };

    expect(overrides.appendSystemPromptOverride?.([]).at(-1)).toContain(
      'model "DeepSeek Coder" (ID: "deepseek-coder")',
    );
  });

  it("prepends Artemis global AGENTS.md and keeps project rules", () => {
    const overrides = createResourceOverrides({
      credentials: {},
      globalAgents: {
        path: "C:\\Users\\me\\AppData\\Artemis\\AGENTS.md",
        content: "# Global",
      },
    });

    expect(
      overrides.agentsFilesOverride?.({
        agentsFiles: [
          {
            path: "D:\\repo\\AGENTS.md",
            content: "# Project",
          },
        ],
      }),
    ).toEqual({
      agentsFiles: [
        {
          path: "C:\\Users\\me\\AppData\\Artemis\\AGENTS.md",
          content: "# Global",
        },
        {
          path: "D:\\repo\\AGENTS.md",
          content: "# Project",
        },
      ],
    });
  });

  it("filters disabled skills without disturbing diagnostics", () => {
    const overrides = createResourceOverrides({
      credentials: {},
      disabledSkillFiles: ["C:\\skills\\off\\SKILL.md"],
    });
    const diagnostics = [{ type: "warning", message: "kept" }] as never[];
    const enabled = {
      name: "enabled",
      description: "",
      filePath: "C:\\skills\\on\\SKILL.md",
    };
    const disabled = {
      name: "disabled",
      description: "",
      filePath: "c:\\skills\\off\\skill.md",
    };

    const result = overrides.skillsOverride?.({
      skills: [enabled, disabled] as never[],
      diagnostics,
    });

    expect(result?.skills).toEqual([enabled]);
    expect(result?.diagnostics).toBe(diagnostics);
  });
});
