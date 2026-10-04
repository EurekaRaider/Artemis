export function serveRuntime(pluginId, tools) {
  let buffered = Buffer.alloc(0);
  let ready = false;
  let busy = false;
  const send = (message) => {
    const body = Buffer.from(JSON.stringify(message));
    if (body.length > 256 * 1024)
      throw new Error("Runtime response exceeds 256 KiB");
    const header = Buffer.alloc(4);
    header.writeUInt32BE(body.length);
    process.stdout.write(Buffer.concat([header, body]));
  };
  const fail = (error) => {
    send({ type: "error", message: String(error) });
    process.stdin.pause();
    process.exitCode = 1;
  };
  const receive = async (message) => {
    if (message.type === "hello" && !ready) {
      if (message.protocolVersion !== 1 || message.pluginId !== pluginId)
        throw new Error("Incompatible host handshake");
      ready = true;
      send({ type: "ready", protocolVersion: 1, pluginId });
      return;
    }
    if (
      !ready ||
      message.type !== "tool.invoke" ||
      typeof message.requestId !== "string"
    )
      throw new Error("Unexpected host message");
    if (busy) throw new Error("Concurrent runtime invocation");
    busy = true;
    try {
      const handler =
        typeof message.toolName === "string" &&
        Object.hasOwn(tools, message.toolName)
          ? tools[message.toolName]
          : undefined;
      if (!handler) throw new Error("Unknown tool");
      if (
        !message.arguments ||
        typeof message.arguments !== "object" ||
        Array.isArray(message.arguments)
      )
        throw new Error("Expected object arguments");
      const result = await handler(message.arguments);
      send({
        type: "tool.result",
        requestId: message.requestId,
        status: "succeeded",
        output: typeof result === "string" ? result : JSON.stringify(result),
      });
    } catch (error) {
      send({
        type: "tool.result",
        requestId: message.requestId,
        status: "failed",
        error: String(error),
      });
    } finally {
      busy = false;
    }
  };
  process.stdin.on("data", (chunk) => {
    try {
      buffered = Buffer.concat([buffered, chunk]);
      while (buffered.length >= 4) {
        const length = buffered.readUInt32BE(0);
        if (length > 256 * 1024 || length === 0)
          throw new Error("Invalid runtime frame size");
        if (buffered.length < length + 4) break;
        const message = JSON.parse(
          buffered.subarray(4, length + 4).toString("utf8"),
        );
        buffered = buffered.subarray(length + 4);
        void receive(message).catch(fail);
      }
    } catch (error) {
      fail(error);
    }
  });
}
