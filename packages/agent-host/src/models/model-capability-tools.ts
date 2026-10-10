import { Type } from "@sinclair/typebox";
import { defineTool, type ModelRuntime } from "@earendil-works/pi-coding-agent";
import type {
  ClassifierContext,
  ImagesContext,
  ModelsImagesOptions,
  JsonValue,
} from "@earendil-works/pi-ai";
import { isExecutionMode, type RunMode } from "@artemis/protocol";

/** Pi performs provider calls; these tools only expose configured capabilities to the desktop. */
export function modelCapabilityTools(
  runtime: ModelRuntime,
  mode: () => RunMode | undefined,
) {
  const requireExecution = () => {
    if (!isExecutionMode(mode()))
      throw new Error("Model operations require Work or Codemode.");
  };
  return [
    defineTool({
      name: "model_capabilities",
      label: "Model capabilities",
      description:
        "List configured image generation and classifier models before invoking them.",
      parameters: Type.Object({}),
      execute: async (_id, _args, signal) => {
        requireExecution();
        const models = (
          await runtime.getAllAvailable(undefined, {
            ...(signal ? { signal } : {}),
          })
        )
          .filter(
            (model) => model.type === "image" || model.type === "classifier",
          )
          .map((model) => ({
            provider: model.provider,
            id: model.id,
            name: model.name,
            type: model.type,
            input: model.input,
          }));
        return {
          content: [{ type: "text" as const, text: JSON.stringify(models) }],
          details: {},
        };
      },
    }),
    defineTool({
      name: "generate_image",
      label: "Generate image",
      description:
        "Generate or edit images using a configured Pi image model. The input is text and optional base64 image content. Results are displayed in the conversation. Discover available models with model_capabilities first.",
      parameters: Type.Object({
        provider: Type.String(),
        model: Type.String(),
        input: Type.Array(
          Type.Union([
            Type.Object({ type: Type.Literal("text"), text: Type.String() }),
            Type.Object({
              type: Type.Literal("image"),
              data: Type.String({ maxLength: 16 * 1024 * 1024 }),
              mimeType: Type.String(),
            }),
          ]),
        ),
        metadata: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
      }),
      execute: async (_id, args, signal) => {
        requireExecution();
        const model = runtime.getModelOfType(
          "image",
          args.provider,
          args.model,
        );
        if (!model || !runtime.hasConfiguredAuth(model.provider))
          throw new Error("Configure this image model provider first.");
        const result = await runtime.generateImages(
          model,
          { input: args.input } as ImagesContext,
          {
            ...(signal ? { signal } : {}),
            ...(args.metadata ? { metadata: args.metadata } : {}),
          } as ModelsImagesOptions,
        );
        if (result.stopReason !== "stop")
          throw new Error(
            result.errorMessage ?? "Image generation did not complete.",
          );
        return {
          content: result.output,
          details: { provider: result.provider, model: result.model },
          ...(result.usage ? { usage: result.usage } : {}),
        };
      },
    }),
    defineTool({
      name: "classify",
      label: "Classify",
      description:
        "Use a configured Pi classifier model. Optional base64 images require a model with image input; discover supported input with model_capabilities first. Questions map names to choice {instructions, criteria: {label:description}}, score {instructions, criteria: string[]}, or bool {instructions, criteria: {true:description,false:description}} questions. Each question includes its type.",
      parameters: Type.Object({
        provider: Type.String(),
        model: Type.String(),
        state: Type.Record(Type.String(), Type.Unknown()),
        images: Type.Optional(
          Type.Array(
            Type.Object({
              type: Type.Literal("image"),
              data: Type.String({ maxLength: 16 * 1024 * 1024 }),
              mimeType: Type.String(),
            }),
          ),
        ),
        questions: Type.Record(
          Type.String(),
          Type.Union([
            Type.Object({
              type: Type.Literal("choice"),
              instructions: Type.String(),
              criteria: Type.Record(Type.String(), Type.String()),
            }),
            Type.Object({
              type: Type.Literal("score"),
              instructions: Type.String(),
              criteria: Type.Array(Type.String()),
            }),
            Type.Object({
              type: Type.Literal("bool"),
              instructions: Type.String(),
              criteria: Type.Object({
                true: Type.String(),
                false: Type.String(),
              }),
            }),
          ]),
        ),
      }),
      outputSchema: Type.Object({
        answers: Type.Record(Type.String(), Type.Unknown()),
      }),
      execute: async (_id, args, signal) => {
        requireExecution();
        const model = runtime.getModelOfType(
          "classifier",
          args.provider,
          args.model,
        );
        if (!model || !runtime.hasConfiguredAuth(model.provider))
          throw new Error("Configure this classifier provider first.");
        const result = await runtime.classify(
          model,
          {
            state: args.state,
            questions: args.questions,
            ...(args.images ? { images: args.images } : {}),
          } as ClassifierContext,
          { ...(signal ? { signal } : {}) },
        );
        if (result.stopReason !== "stop")
          throw new Error(
            result.errorMessage ?? "Classification did not complete.",
          );
        return {
          content: [
            { type: "text" as const, text: JSON.stringify(result.answers) },
          ],
          structuredContent: JSON.parse(
            JSON.stringify({ answers: result.answers }),
          ) as JsonValue,
          details: {},
          ...(result.usage ? { usage: result.usage } : {}),
        };
      },
    }),
  ];
}
