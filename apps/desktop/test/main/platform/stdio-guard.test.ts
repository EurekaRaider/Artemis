import { Console } from "node:console";
import { Writable } from "node:stream";
import { describe, expect, it, vi } from "vitest";

import { guardStdio } from "../../../src/main/platform/stdio-guard.js";

const brokenPipe = () =>
  Object.assign(new Error("write EPIPE"), { code: "EPIPE" });

describe("stdio guard", () => {
  it("keeps console logging usable after synchronous broken-pipe errors", () => {
    const stream = new Writable();
    stream.write = () => {
      throw brokenPipe();
    };
    const logger = new Console({
      stdout: stream,
      stderr: stream,
      ignoreErrors: false,
    });
    expect(() => logger.error("IPC failure")).toThrow("write EPIPE");
    guardStdio(stream);
    expect(() => {
      logger.error("IPC failure");
      logger.log("quitting");
      logger.error("another IPC failure");
    }).not.toThrow();
  });

  it("handles asynchronous broken-pipe errors", async () => {
    const stream = new Writable({
      write(_chunk, _encoding, callback) {
        callback(brokenPipe());
      },
    });
    guardStdio(stream);
    const closed = new Promise<void>((resolve) =>
      stream.once("close", resolve),
    );
    stream.write("IPC failure");
    await closed;
    expect(stream.errored).toMatchObject({ code: "EPIPE" });
  });

  it("preserves successful writes and their callbacks", async () => {
    const chunks: string[] = [];
    const stream = new Writable({
      write(chunk, _encoding, callback) {
        chunks.push(String(chunk));
        callback();
      },
    });
    guardStdio(stream);
    await new Promise<void>((resolve, reject) => {
      expect(
        stream.write("normal log", "utf8", (error) =>
          error ? reject(error) : resolve(),
        ),
      ).toBe(true);
    });
    expect(chunks).toEqual(["normal log"]);
  });

  it("reports a synchronous EPIPE to an explicit write callback", async () => {
    const stream = new Writable();
    const error = brokenPipe();
    stream.write = () => {
      throw error;
    };
    guardStdio(stream);
    const callback = vi.fn();
    expect(stream.write("log", callback)).toBe(false);
    await new Promise<void>((resolve) => process.nextTick(resolve));
    expect(callback).toHaveBeenCalledExactlyOnceWith(error);
  });

  it("does not suppress unrelated synchronous or asynchronous failures", () => {
    const stream = new Writable();
    const error = Object.assign(new Error("I/O failure"), { code: "EIO" });
    stream.write = () => {
      throw error;
    };
    guardStdio(stream);
    expect(() => stream.write("log")).toThrow(error);
    expect(() => stream.emit("error", error)).toThrow(error);
  });
});
