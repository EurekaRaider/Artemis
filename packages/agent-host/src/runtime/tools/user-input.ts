import { type OpenThreadRequest } from "../runtime-types.js";

import { randomUUID } from "node:crypto";

import { defineTool } from "@earendil-works/pi-coding-agent";

import { Type } from "@sinclair/typebox";

import { MAX_USER_INPUT_QUESTIONS } from "@artemis/protocol";

import type { BrokerToolContext } from "./broker-tool-context.js";
export function createRequestUserInputTool(
  request: OpenThreadRequest,
  context: Pick<BrokerToolContext, "threads" | "serializeUserInput" | "broker">,
) {
  const userInputParameters = Type.Object(
    {
      header: Type.String({
        minLength: 1,
        maxLength: 12,
        description: "Short topic label for the choice card.",
      }),
      questions: Type.Array(
        Type.Object(
          {
            question: Type.String({ minLength: 1, maxLength: 1_000 }),
            options: Type.Array(
              Type.Object(
                {
                  label: Type.String({ minLength: 1, maxLength: 80 }),
                  description: Type.String({
                    minLength: 1,
                    maxLength: 240,
                  }),
                  recommended: Type.Optional(
                    Type.Boolean({
                      default: false,
                      description:
                        "Mark exactly one option in each question true. Omitted means false.",
                    }),
                  ),
                },
                { additionalProperties: false },
              ),
              { minItems: 2, maxItems: 3 },
            ),
          },
          { additionalProperties: false },
        ),
        {
          minItems: 1,
          maxItems: MAX_USER_INPUT_QUESTIONS,
          description:
            "One to three single-choice questions, answered in order. Use a one-item array for a single question.",
        },
      ),
    },
    { additionalProperties: false },
  );

  const requestUserInputTool = defineTool({
    name: "request_user_input",
    label: "Ask the user",
    description:
      "Pause for user decisions. Always supply a questions array containing one focused question or up to three closely related questions, each with two or three mutually exclusive options and exactly one option per question marked as recommended. The user answers one single-choice question at a time. Use this for requirement, design, or workflow decisions, never for execution approval. The desktop may select each recommended option after five minutes without an answer.",
    parameters: userInputParameters,
    execute: async (_toolCallId, params) => {
      const hosted = context.threads.get(request.threadId);
      if (!hosted?.currentTurnId || !hosted.currentMode) {
        throw new Error("No active turn is available for user input.");
      }
      if ("question" in params || "options" in params) {
        throw new Error("User input accepts a questions array.");
      }
      const header = params.header.trim();
      const questions = params.questions.map((question, index) => ({
        // IDs belong to this request, not to the model's response format.
        questionId: `q${index + 1}`,
        question: question.question.trim(),
        options: question.options.map((option) => ({
          label: option.label.trim(),
          description: option.description.trim(),
          recommended: option.recommended ?? false,
        })),
      }));
      if (
        !header ||
        questions.length < 1 ||
        questions.length > MAX_USER_INPUT_QUESTIONS ||
        questions.some(
          (question) =>
            !question.question ||
            question.options.length < 2 ||
            question.options.length > 3 ||
            question.options.some(
              (option) => !option.label || !option.description,
            ) ||
            question.options.filter((option) => option.recommended).length !==
              1 ||
            new Set(question.options.map((option) => option.label)).size !==
              question.options.length,
        )
      ) {
        throw new Error(
          "User input requires a non-empty header and one to three non-empty questions with two or three unique, non-empty options and exactly one recommendation each.",
        );
      }
      const turnId = hosted.currentTurnId;
      const mode = hosted.currentMode;
      const result = await context.serializeUserInput(request.threadId, () => {
        const active = context.threads.get(request.threadId);
        if (active?.currentTurnId !== turnId) {
          throw new Error("The turn ended before this question was shown.");
        }
        return context.broker.request({
          kind: "user.input",
          approvalId: randomUUID(),
          threadId: request.threadId,
          turnId,
          workspacePath: request.workspacePath,
          header,
          ...(questions.length === 1
            ? {
                question: questions[0]!.question,
                options: questions[0]!.options,
              }
            : { questions }),
          mode,
        });
      });
      if (!result.approved) {
        throw new Error(result.error ?? "User input was cancelled.");
      }
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result.data ?? {}, null, 2),
          },
        ],
        details: result.data,
      };
    },
  });
  return requestUserInputTool;
}
