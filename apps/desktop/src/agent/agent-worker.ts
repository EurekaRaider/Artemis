import { randomUUID } from "node:crypto";

import { ArtemisAgentHost, type AgentBroker } from "@artemis/agent-host";
import {
  AGENT_CONCURRENCY_FALLBACK,
  AGENT_CONCURRENCY_MAXIMUM,
  AGENT_CONCURRENCY_MINIMUM,
  type AgentHostCommand,
  type AgentHostMessage,
  type BrokerExecutionRequest,
} from "@artemis/protocol";

import { expandProjectInitCommand } from "../shared/project-init-command.js";
import { AgentEventBatcher } from "./agent-event-batcher.js";

interface ParentPort {
  on(event: "message", listener: (event: { data: unknown }) => void): void;
  postMessage(message: unknown): void;
}

interface PendingBroker {
  resolve(value: { approved: boolean; data?: unknown; error?: string }): void;
}

const parentPort = (process as NodeJS.Process & { parentPort?: ParentPort })
  .parentPort;

if (!parentPort) {
  throw new Error("Artemis agent worker requires an Electron parent port.");
}

const pendingBroker = new Map<string, PendingBroker>();

function initialAgentConcurrencyLimit(): number {
  const value = Number(
    process.env.ARTEMIS_AGENT_CONCURRENCY_LIMIT ?? AGENT_CONCURRENCY_FALLBACK,
  );
  if (
    !Number.isInteger(value) ||
    value < AGENT_CONCURRENCY_MINIMUM ||
    value > AGENT_CONCURRENCY_MAXIMUM
  ) {
    throw new Error(
      `ARTEMIS_AGENT_CONCURRENCY_LIMIT must be an integer from ${AGENT_CONCURRENCY_MINIMUM} to ${AGENT_CONCURRENCY_MAXIMUM}.`,
    );
  }
  return value;
}

function send(message: AgentHostMessage): void {
  parentPort!.postMessage(message);
}

const eventBatcher = new AgentEventBatcher((events) => {
  send({ type: "events", events });
});

const broker: AgentBroker = {
  request(request: BrokerExecutionRequest) {
    const requestId = randomUUID();
    return new Promise((resolve) => {
      pendingBroker.set(requestId, { resolve });
      send({ type: "broker.request", requestId, request });
    });
  },
};

const host = new ArtemisAgentHost(
  broker,
  {
    emit(threadId, turnId, payload) {
      eventBatcher.push({
        threadId,
        ...(turnId ? { turnId } : {}),
        payload,
      });
    },
  },
  {
    agentConcurrencyLimit: initialAgentConcurrencyLimit(),
    onSessionFile(threadId, sessionFile) {
      send({ type: "thread.session", threadId, sessionFile });
    },
  },
);

async function handle(command: AgentHostCommand): Promise<void> {
  if (command.type === "broker.resolve") {
    const pending = pendingBroker.get(command.requestId);
    if (pending) {
      pendingBroker.delete(command.requestId);
      pending.resolve({
        approved: command.resolution.approved,
        ...(command.result === undefined ? {} : { data: command.result }),
        ...(command.error ? { error: command.error } : {}),
      });
    }
    return;
  }

  try {
    let data: unknown;
    switch (command.type) {
      case "runtime.configure":
        await host.configure(command.configuration);
        break;
      case "runtime.catalog":
        data = await host.catalog();
        break;
      case "runtime.concurrency.set":
        data = host.setConcurrencyLimit(command.limit);
        break;
      case "runtime.concurrency.status":
        data = host.concurrencyStatus();
        break;
      case "thread.open":
        data = await host.openThread({
          threadId: command.threadId,
          workspacePath: command.workspacePath,
          target: command.target,
          ...(command.sessionFile ? { sessionFile: command.sessionFile } : {}),
          ...(command.selection ? { selection: command.selection } : {}),
          ...(command.contextWindow
            ? { contextWindow: command.contextWindow }
            : {}),
        });
        break;
      case "thread.model.set":
        await host.setThreadModel(
          command.threadId,
          command.selection,
          command.contextWindow,
        );
        break;
      case "thread.compact":
        await host.compact(command.threadId, command.instructions);
        break;
      case "turn.prompt": {
        send({
          type: "turn.telemetry",
          threadId: command.threadId,
          turnId: command.turnId,
          stage: "host-received",
          timestamp: Date.now(),
        });
        await host.prompt(
          command.threadId,
          command.turnId,
          expandProjectInitCommand(command.text),
          command.mode,
          command.attachments,
          command.goal,
          command.memoryContext,
        );
        break;
      }
      case "turn.cancel":
        await host.cancel(command.threadId);
        break;
      case "turn.steer":
        await host.steer(
          command.threadId,
          expandProjectInitCommand(command.text),
          command.attachments,
        );
        break;
      case "turn.follow-up":
        await host.followUp(
          command.threadId,
          expandProjectInitCommand(command.text),
          command.attachments,
        );
        break;
      case "turn.queue.clear":
        data = host.clearQueue(command.threadId);
        break;
      case "turn.queue.steer":
        await host.steerQueue(command.threadId);
        break;
      case "child.status":
        data = host.childAgentStatus(command.threadId, command.agentId);
        break;
      case "child.steer":
        data = await host.steerChildAgent(
          command.threadId,
          command.agentId,
          command.text,
          true,
        );
        break;
      case "child.cancel":
        data = await host.cancelChildAgent(
          command.threadId,
          command.agentId,
          true,
        );
        break;
      case "child.retry":
        data = host.retryChildAgent(command.threadId, command.agentId, true);
        break;
      case "team.cancel":
        data = await host.cancelAgentTeam(
          command.threadId,
          command.teamId,
          true,
        );
        break;
      case "thread.fork":
        data = host.forkThread(command.threadId, command.entryId);
        break;
      case "thread.close":
        host.closeThread(command.threadId);
        break;
      case "thread.delete":
        await host.deleteThread(command.threadId, command.sessionFile);
        break;
    }
    send({
      type: "response",
      requestId: command.requestId,
      ok: true,
      ...(data === undefined ? {} : { data }),
    });
  } catch (error) {
    send({
      type: "response",
      requestId: command.requestId,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

parentPort.on("message", (event) => {
  void handle(event.data as AgentHostCommand);
});

process.on("SIGTERM", () => {
  host.dispose();
  eventBatcher.dispose();
  process.exit(0);
});
