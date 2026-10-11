/** Host-owned, per-turn suffix. This is metadata, never a user message. */
export function composerPredictionMarker(token: string): string {
  return `\n<artemis-prediction:${token}>`;
}

const END = "</artemis-prediction>";
const MAX_TAIL = 1024;

export function composerPredictionInstruction(token: string): string {
  return `\n\n[Artemis composer prediction ${token}]\nOnly for your final ordinary text answer, optionally append ${composerPredictionMarker(token)}{"suggestion":"a likely next user message"}${END}. Use the user's language and voice, at most 120 characters. Omit it if no natural follow-up exists, if awaiting a decision/approval/plan confirmation, or if it would invent consent or personal facts. Do not use tools to generate it. The suffix is UI metadata, not part of the answer. Never append it to intermediate messages, code blocks, tool calls or structured output. Use only this turn's marker.\n[End Artemis composer prediction]\n`;
}

/** Keeps at most MAX_TAIL plus one delimiter; ordinary text streams immediately. */
export class ComposerPredictionParser {
  private pending = "";
  private tail = false;
  private ended = false;
  private overflow = false;
  suggestion: string | undefined;

  constructor(private readonly marker: string) {}

  push(delta: string): string {
    if (this.ended) {
      if (delta.trim()) this.suggestion = undefined;
      return delta;
    }
    this.pending += delta;
    let visible = "";
    if (!this.tail) {
      const start = this.pending.indexOf(this.marker);
      if (start < 0) {
        let keep = Math.min(this.pending.length, this.marker.length - 1);
        while (keep > 0 && !this.marker.startsWith(this.pending.slice(-keep)))
          keep--;
        visible = this.pending.slice(0, this.pending.length - keep);
        this.pending = keep ? this.pending.slice(-keep) : "";
        return visible;
      }
      visible = this.pending.slice(0, start);
      this.pending = this.pending.slice(start + this.marker.length);
      this.tail = true;
    }
    const end = this.pending.indexOf(END);
    if (end >= 0) {
      const raw = this.pending.slice(0, end);
      const rest = this.pending.slice(end + END.length);
      if (!this.overflow && raw.length <= MAX_TAIL && !rest.trim()) {
        try {
          const value: unknown = JSON.parse(raw);
          if (
            value &&
            typeof value === "object" &&
            "suggestion" in value &&
            typeof value.suggestion === "string"
          ) {
            const text = value.suggestion.trim();
            if (
              text &&
              Array.from(text).length <= 120 &&
              !/[\r\n\x00-\x1f]/u.test(text)
            )
              this.suggestion = text;
          }
        } catch {
          /* Invalid metadata is silently omitted. */
        }
      }
      this.pending = "";
      this.ended = true;
      return visible + rest;
    }
    if (this.pending.length > MAX_TAIL) {
      this.overflow = true;
      this.pending = this.pending.slice(-(END.length - 1));
    }
    return visible;
  }

  finish(): string {
    const remaining = this.tail ? "" : this.pending;
    this.pending = "";
    return remaining;
  }
}

export function stripComposerPrediction(text: string, token: string): string {
  const parser = new ComposerPredictionParser(composerPredictionMarker(token));
  return parser.push(text) + parser.finish();
}
