import type { AgentHostEvent, AgentPayload } from "@artemis/protocol";

const DEFAULT_FLUSH_INTERVAL_MS = 32;
const DEFAULT_MAX_CHARACTERS = 512;

interface BufferedDelta {
  event: AgentHostEvent;
  characters: number;
}

type MessageDelta = Extract<AgentPayload, { type: "message.part.delta" }>;
type ChildActivity = Extract<AgentPayload, { type: "child-agent.status" }>;

function isVisibleTextDelta(
  event: AgentHostEvent,
): event is AgentHostEvent & { payload: MessageDelta } {
  return (
    event.payload.type === "message.part.delta" &&
    event.payload.partType === "text" &&
    event.payload.delta.length > 0
  );
}

function deltaKey(event: AgentHostEvent): string {
  if (event.payload.type !== "message.part.delta") return "";
  return `${event.threadId}\0${event.turnId ?? ""}\0${event.payload.partId}`;
}

function isChildActivity(
  event: AgentHostEvent,
): event is AgentHostEvent & { payload: ChildActivity } {
  return (
    event.payload.type === "child-agent.status" &&
    Boolean(event.payload.activityDelta)
  );
}

function childActivityKey(event: AgentHostEvent): string {
  return event.payload.type === "child-agent.status"
    ? `${event.threadId}\0${event.payload.agentId}`
    : "";
}

export class AgentEventBatcher {
  private readonly visibleParts = new Set<string>();
  private buffered: BufferedDelta | undefined;
  private readonly childActivities = new Map<string, AgentHostEvent>();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private childActivityTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private readonly emit: (events: AgentHostEvent[]) => void,
    private readonly flushIntervalMs = DEFAULT_FLUSH_INTERVAL_MS,
    private readonly maxCharacters = DEFAULT_MAX_CHARACTERS,
  ) {}

  push(event: AgentHostEvent): void {
    if (isChildActivity(event)) {
      this.flushText();
      const key = childActivityKey(event);
      const previous = this.childActivities.get(key);
      this.childActivities.set(
        key,
        previous?.payload.type === "child-agent.status"
          ? {
              ...event,
              payload: {
                ...event.payload,
                activityDelta:
                  `${previous.payload.activityDelta ?? ""}${event.payload.activityDelta ?? ""}`.slice(
                    -8 * 1024,
                  ),
              },
            }
          : event,
      );
      this.childActivityTimer ??= setTimeout(
        () => this.flushChildActivities(),
        this.flushIntervalMs,
      );
      return;
    }
    if (!isVisibleTextDelta(event)) {
      this.flush();
      this.emit([event]);
      if (
        event.turnId &&
        (event.payload.type === "turn.completed" ||
          event.payload.type === "turn.failed")
      ) {
        const prefix = `${event.threadId}\0${event.turnId}\0`;
        for (const key of this.visibleParts) {
          if (key.startsWith(prefix)) this.visibleParts.delete(key);
        }
      }
      return;
    }

    const key = deltaKey(event);
    if (!this.visibleParts.has(key)) {
      this.visibleParts.add(key);
      this.flush();
      this.emit([event]);
      return;
    }

    if (this.buffered && deltaKey(this.buffered.event) !== key) {
      this.flush();
    }

    if (!this.buffered) {
      this.buffered = { event, characters: event.payload.delta.length };
      this.timer = setTimeout(() => this.flush(), this.flushIntervalMs);
    } else if (this.buffered.event.payload.type === "message.part.delta") {
      this.buffered.event = {
        ...this.buffered.event,
        payload: {
          ...this.buffered.event.payload,
          delta: this.buffered.event.payload.delta + event.payload.delta,
        },
      };
      this.buffered.characters += event.payload.delta.length;
    }

    if (this.buffered.characters >= this.maxCharacters) {
      this.flush();
    }
  }

  flush(): void {
    this.flushText();
    this.flushChildActivities();
  }

  private flushText(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    const buffered = this.buffered;
    this.buffered = undefined;
    if (buffered) this.emit([buffered.event]);
  }

  private flushChildActivities(): void {
    if (this.childActivityTimer) {
      clearTimeout(this.childActivityTimer);
      this.childActivityTimer = undefined;
    }
    if (this.childActivities.size === 0) return;
    const events = [...this.childActivities.values()];
    this.childActivities.clear();
    this.emit(events);
  }

  dispose(): void {
    this.flush();
  }
}
