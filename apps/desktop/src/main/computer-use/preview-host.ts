import { randomUUID } from "node:crypto";
import type { WebContents } from "electron";
import type {
  ComputerControlState,
  ComputerPreviewState,
  ComputerPreviewCommand,
  ComputerTarget,
} from "@artemis/protocol";
import { PreviewStream } from "./preview-stream.js";
import { NativePreviewSource } from "./native-preview.js";
import type {
  ComputerNativeDriver,
  ComputerHelperLease,
} from "./native-driver.js";
import type { BrowserSessionHost } from "../workspace/browser-session-host.js";

interface Session {
  state: ComputerPreviewState;
  stream: PreviewStream;
  native?: NativePreviewSource | undefined;
  eligible: boolean;
  hidden: boolean;
  subscribers: Map<string, WebContents>;
  expanded: Set<string>;
  maximum: 640 | 960 | 1280 | 1920;
  slowIntervals: number;
  healthyIntervals: number;
  removeFailureListener?: () => void;
}
export class ComputerPreviewHost {
  private readonly sessions = new Map<string, Session>();
  constructor(
    private readonly options: {
      driver: ComputerNativeDriver;
      acquire(): Promise<ComputerHelperLease>;
      browsers: BrowserSessionHost;
      authorized(
        threadId: string,
        targetId?: string,
      ): { target: ComputerTarget } | undefined;
      publish(states: ComputerPreviewState[]): void;
      expand(state: ComputerPreviewState): void;
    },
  ) {}
  states() {
    return [...this.sessions.values()].map((session) =>
      structuredClone(session.state),
    );
  }
  private publish() {
    this.options.publish(this.states());
  }
  update(control: ComputerControlState) {
    if (!control.threadId) return;
    const current = [...this.sessions.values()].find(
      (session) => session.state.threadId === control.threadId,
    );
    const authorized = this.options.authorized(
      control.threadId,
      control.target?.id,
    );
    if (!authorized) {
      if (!current) return;
      current.eligible = false;
      current.native?.stop();
      current.native = undefined;
      for (const token of current.subscribers.keys())
        current.stream.unsubscribe(token);
      current.state.state =
        control.state === "paused" &&
        /^(User |Native Stop)/u.test(control.reason ?? "")
          ? "paused"
          : "ended";
      if (control.reason) current.state.reason = control.reason;
      current.state.actualFps = 0;
      current.state.timestamp = Date.now();
      if (current.state.state === "ended") {
        this.close(current);
      }
      this.publish();
      return;
    }
    if (
      current &&
      current.state.target.id === authorized.target.id &&
      current.state.state !== "unavailable"
    ) {
      current.eligible = true;
      if (current.state.state === "paused") {
        delete current.state.reason;
        this.start(current);
      }
      const source = current.native;
      if (source && control.state === "observing")
        void source
          .sameWindow(authorized.target)
          .then((same) => {
            if (!same && current.native === source) {
              source.stop();
              current.native = undefined;
              this.start(current);
            }
          })
          .catch((error) => {
            if (current.native === source) this.fail(current, error);
          });
      return;
    }
    if (current) this.close(current);
    const id = randomUUID();
    const browser =
      authorized.target.kind === "browser"
        ? this.options.browsers.owned(
            control.threadId,
            Number(authorized.target.id.slice(8)),
          )
        : undefined;
    const session: Session = {
      state: {
        version: 1,
        sessionId: id,
        threadId: control.threadId,
        target: authorized.target,
        state: "starting",
        timestamp: Date.now(),
        sequence: 0,
        actualFps: 0,
        ...(browser ? { tabId: browser.tabId } : {}),
      },
      eligible: true,
      hidden: false,
      subscribers: new Map(),
      expanded: new Set(),
      maximum: 1280,
      slowIntervals: 0,
      healthyIntervals: 0,
      stream:
        browser?.stream ??
        new PreviewStream(
          id,
          (visible) => {
            if (visible) this.start(session);
            else {
              session.native?.stop();
              session.native = undefined;
            }
          },
          (error) => this.fail(session, error),
        ),
    };
    if (authorized.target.kind === "browser" && !browser)
      session.state.state = "unavailable";
    if (browser)
      session.removeFailureListener = browser.stream.onFailure((error) =>
        this.fail(session, error),
      );
    this.sessions.set(id, session);
    this.publish();
  }
  private start(session: Session) {
    if (
      session.eligible &&
      !session.hidden &&
      session.state.state !== "unavailable"
    )
      for (const [token, contents] of session.subscribers)
        if (!contents.isDestroyed()) session.stream.subscribe(token, contents);
    if (
      !session.eligible ||
      session.hidden ||
      !session.stream.visible() ||
      session.native ||
      session.state.state === "unavailable"
    )
      return;
    if (session.state.target.kind === "browser") {
      session.state.state = "live";
      this.publish();
      return;
    }
    const source = new NativePreviewSource(
      this.options.driver,
      this.options.acquire,
    );
    session.native = source;
    session.state.state = "starting";
    this.publish();
    void source
      .start(
        session.state.target,
        session.expanded.size ? 1920 : 1280,
        (frame) => {
          if (
            session.native !== source ||
            !session.eligible ||
            session.hidden
          ) {
            frame.release();
            return;
          }
          if (frame.error) {
            frame.release();
            this.fail(session, new Error(frame.error));
            return;
          }
          session.stream.push({
            textureInfo: {
              pixelFormat: "bgra",
              codedSize: { width: frame.width, height: frame.height },
              handle: {
                ...(frame.ioSurface ? { ioSurface: frame.ioSurface } : {}),
                ...(frame.ntHandle ? { ntHandle: frame.ntHandle } : {}),
              },
            },
            capturedAt: frame.capturedAt,
            release: frame.release,
          });
          if (session.state.state !== "live") {
            session.state.state = "live";
            this.publish();
          }
        },
      )
      .then(() => {
        if (session.native === source) source.resize(session.maximum);
      })
      .catch((error) => {
        if (session.native === source) this.fail(session, error);
      });
  }
  private fail(session: Session, error: unknown) {
    session.native?.stop();
    session.native = undefined;
    session.state.state = "unavailable";
    for (const token of session.subscribers.keys())
      session.stream.unsubscribe(token);
    session.state.reason =
      error instanceof Error ? error.message : String(error);
    session.state.actualFps = 0;
    this.publish();
  }
  command(input: ComputerPreviewCommand, sender: WebContents) {
    if (input.action === "unsubscribe") {
      for (const session of this.sessions.values())
        if (session.subscribers.get(input.token) === sender) {
          session.subscribers.delete(input.token);
          session.stream.unsubscribe(input.token);
          session.expanded.delete(input.token);
          this.resolution(session);
        }
      return;
    }
    const session = this.sessions.get(input.sessionId);
    if (!session || session.state.state === "ended")
      throw new Error("Preview session is no longer available");
    if (input.action === "subscribe") {
      if (session.hidden) throw new Error("Preview is hidden");
      if (
        session.subscribers.has(input.token) &&
        session.subscribers.get(input.token) !== sender
      )
        throw new Error("Preview subscriber ownership mismatch");
      session.subscribers.set(input.token, sender);
      if (input.expanded) session.expanded.add(input.token);
      else session.expanded.delete(input.token);
      this.resolution(session);
      if (session.eligible && session.state.state !== "unavailable")
        session.stream.subscribe(input.token, sender);
      this.start(session);
    } else if (input.action === "hide") {
      session.hidden = true;
      session.native?.stop();
      session.native = undefined;
      for (const token of session.subscribers.keys())
        session.stream.unsubscribe(token);
      session.state.state = "hidden";
      this.publish();
    } else if (input.action === "show") {
      session.hidden = false;
      session.state.state = session.stream.stopped()
        ? "unavailable"
        : session.eligible
          ? "starting"
          : "paused";
      this.start(session);
      this.publish();
    } else this.options.expand(session.state);
  }
  report(
    sender: WebContents,
    token: string,
    report: { fps: number; p95Ms: number; sequence: number },
  ) {
    const session = [...this.sessions.values()].find((value) =>
      value.stream.owns(token, sender),
    );
    if (
      !session ||
      !Number.isFinite(report.fps) ||
      !Number.isFinite(report.p95Ms) ||
      report.fps < 0 ||
      report.fps > 240 ||
      report.p95Ms < 0 ||
      report.p95Ms > 60000 ||
      !Number.isSafeInteger(report.sequence)
    )
      return;
    session.state.actualFps = report.fps;
    session.state.p95LatencyMs = report.p95Ms;
    session.state.sequence = report.sequence;
    session.state.timestamp = Date.now();
    this.publish();
    if (session.native && report.fps > 0) {
      const slow = report.fps < 52 && report.p95Ms > 100;
      session.slowIntervals = slow ? session.slowIntervals + 1 : 0;
      session.healthyIntervals =
        report.fps >= 55 && report.p95Ms < 80
          ? session.healthyIntervals + 1
          : 0;
      if (session.slowIntervals >= 3) {
        session.maximum =
          session.maximum === 1920
            ? 1280
            : session.maximum === 1280
              ? 960
              : 640;
        session.native.resize(session.maximum);
        session.slowIntervals = 0;
      } else if (session.healthyIntervals >= 10) {
        const ceiling = session.expanded.size ? 1920 : 1280;
        session.maximum = Math.min(
          ceiling,
          session.maximum === 640 ? 960 : session.maximum === 960 ? 1280 : 1920,
        ) as Session["maximum"];
        session.native.resize(session.maximum);
        session.healthyIntervals = 0;
      }
    }
  }
  private resolution(session: Session) {
    session.maximum = session.expanded.size ? 1920 : 1280;
    session.slowIntervals = 0;
    session.healthyIntervals = 0;
    session.native?.resize(session.maximum);
  }
  private close(session: Session) {
    session.removeFailureListener?.();
    session.native?.stop();
    for (const token of session.subscribers.keys())
      session.stream.unsubscribe(token);
    if (session.state.target.kind === "desktop") session.stream.close();
    this.sessions.delete(session.state.sessionId);
  }
  removeContents(contents: WebContents) {
    for (const session of this.sessions.values()) {
      for (const [token, owner] of session.subscribers)
        if (owner === contents) {
          session.subscribers.delete(token);
          session.expanded.delete(token);
        }
      session.stream.removeContents(contents);
      this.resolution(session);
    }
  }
  closeTarget(targetId: string) {
    for (const session of [...this.sessions.values()])
      if (session.state.target.id === targetId) this.close(session);
    this.publish();
  }
  dispose() {
    for (const session of [...this.sessions.values()]) this.close(session);
    this.publish();
  }
}
