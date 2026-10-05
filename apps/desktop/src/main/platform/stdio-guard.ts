import type { Writable } from "node:stream";

function isBrokenPipe(error: unknown): boolean {
  return (
    error !== null &&
    typeof error === "object" &&
    "code" in error &&
    error.code === "EPIPE"
  );
}

// A desktop app can outlive the terminal or launcher that owns its log pipes.
// Handle only stdio EPIPE here; unrelated failures must remain observable.
export function guardStdio(stream: Writable): void {
  const write = stream.write.bind(stream);
  stream.write = (
    chunk: unknown,
    encoding?: BufferEncoding | ((error?: Error | null) => void),
    callback?: (error?: Error | null) => void,
  ): boolean => {
    try {
      return typeof encoding === "string"
        ? write(chunk, encoding, callback)
        : write(chunk, encoding);
    } catch (error) {
      if (!isBrokenPipe(error)) throw error;
      const onError = typeof encoding === "function" ? encoding : callback;
      if (onError) {
        process.nextTick(onError, error);
      }
      return false;
    }
  };
  stream.on("error", (error: Error) => {
    if (!isBrokenPipe(error)) throw error;
  });
}
