import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { createExtensionRuntime } from "@earendil-works/pi-coding-agent";

const RESULT_PREFIX = "ARTEMIS_EXTENSION_RESULT:";

interface ExtensionRequestBase {
  extensionPath: string;
  expectedHash: string;
  workspacePath: string;
}

type ExtensionWorkerRequest =
  | (ExtensionRequestBase & { type: "discover" })
  | (ExtensionRequestBase & {
      type: "execute";
      toolName: string;
      arguments: Record<string, unknown>;
    });

interface LoadedTool {
  name: string;
  label: string;
  description: string;
  parameters: Record<string, unknown>;
  execute(
    toolCallId: string,
    parameters: Record<string, unknown>,
    signal: AbortSignal | undefined,
    onUpdate: undefined,
    context: unknown,
  ): Promise<{ content?: unknown[]; details?: unknown }>;
}

interface LoadedExtension {
  path: string;
  handlers: Map<string, unknown[]>;
  tools: Map<string, { definition: LoadedTool }>;
  commands: Map<string, unknown>;
  flags: Map<string, unknown>;
  shortcuts: Map<string, unknown>;
}

interface LoadResult {
  extensions: LoadedExtension[];
  errors: Array<{ path: string; error: string }>;
}

async function readRequest(): Promise<ExtensionWorkerRequest> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    const total = chunks.reduce((sum, value) => sum + value.length, 0);
    if (total > 2 * 1024 * 1024) {
      throw new Error("Extension request exceeds 2 MiB");
    }
  }
  return JSON.parse(
    Buffer.concat(chunks).toString("utf8"),
  ) as ExtensionWorkerRequest;
}

async function verifyHash(path: string, expectedHash: string): Promise<void> {
  const actualHash = createHash("sha256")
    .update(await readFile(path))
    .digest("hex");
  if (actualHash !== expectedHash) {
    throw new Error("Trusted extension changed after approval");
  }
}

async function loadExactExtension(
  extensionPath: string,
  workspacePath: string,
): Promise<LoadedExtension> {
  const piEntry = fileURLToPath(
    import.meta.resolve("@earendil-works/pi-coding-agent"),
  );
  const loaderUrl = pathToFileURL(
    resolve(dirname(piEntry), "core", "extensions", "loader.js"),
  ).href;
  const loader = (await import(loaderUrl)) as {
    loadExtensions(
      paths: string[],
      cwd: string,
      eventBus?: unknown,
      runtime?: unknown,
    ): Promise<LoadResult>;
  };
  const loaded = await loader.loadExtensions(
    [extensionPath],
    workspacePath,
    undefined,
    createExtensionRuntime(),
  );
  if (loaded.errors.length > 0) {
    throw new Error(loaded.errors.map((error) => error.error).join("\n"));
  }
  const extension = loaded.extensions.find(
    (candidate) => resolve(candidate.path) === resolve(extensionPath),
  );
  if (!extension) {
    throw new Error("Pi did not load the trusted extension");
  }
  return extension;
}

function extensionContext(workspacePath: string): Record<string, unknown> {
  const unavailable = () => {
    throw new Error(
      "This Pi extension context operation is unavailable in the sandboxed tool host",
    );
  };
  const ui = new Proxy(
    {},
    {
      get: () => unavailable,
    },
  );
  return {
    ui,
    mode: "rpc",
    hasUI: false,
    cwd: workspacePath,
    sessionManager: {},
    modelRegistry: {},
    model: undefined,
    thinkingLevel: undefined,
    isIdle: () => true,
    isProjectTrusted: () => true,
    signal: undefined,
    abort: unavailable,
    hasPendingMessages: () => false,
    shutdown: unavailable,
    getContextUsage: () => undefined,
    compact: unavailable,
    getSystemPrompt: () => "",
  };
}

async function handle(request: ExtensionWorkerRequest): Promise<unknown> {
  await verifyHash(request.extensionPath, request.expectedHash);
  const extension = await loadExactExtension(
    request.extensionPath,
    request.workspacePath,
  );
  if (request.type === "discover") {
    return {
      tools: [...extension.tools.values()].map(({ definition }) => ({
        name: definition.name,
        label: definition.label,
        description: definition.description,
        inputSchema: definition.parameters,
      })),
      unsupported: {
        handlers: [...extension.handlers.values()].reduce(
          (sum, handlers) => sum + handlers.length,
          0,
        ),
        commands: extension.commands.size,
        flags: extension.flags.size,
        shortcuts: extension.shortcuts.size,
      },
    };
  }

  const registered = extension.tools.get(request.toolName);
  if (!registered) {
    throw new Error(`Extension tool is unavailable: ${request.toolName}`);
  }
  const result = await registered.definition.execute(
    `extension-${Date.now()}`,
    request.arguments,
    undefined,
    undefined,
    extensionContext(request.workspacePath),
  );
  return {
    content: result.content ?? [],
    details: result.details,
  };
}

try {
  const result = await handle(await readRequest());
  process.stdout.write(
    `${RESULT_PREFIX}${JSON.stringify({ ok: true, result })}\n`,
  );
} catch (error) {
  process.stdout.write(
    `${RESULT_PREFIX}${JSON.stringify({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    })}\n`,
  );
  process.exitCode = 1;
}
