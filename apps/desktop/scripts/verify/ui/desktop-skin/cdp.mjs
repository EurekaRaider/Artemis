export class CdpConnection {
  constructor(webSocket) {
    this.webSocket = webSocket;
    this.nextId = 1;
    this.pending = new Map();
    webSocket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data));
      if (message.id === undefined) return;
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(message.error.message));
      else pending.resolve(message.result);
    });
  }

  static async connect(url) {
    const webSocket = new WebSocket(url);
    await new Promise((resolvePromise, rejectPromise) => {
      webSocket.addEventListener("open", resolvePromise, { once: true });
      webSocket.addEventListener("error", rejectPromise, { once: true });
    });
    return new CdpConnection(webSocket);
  }

  send(method, params = {}) {
    const id = this.nextId;
    this.nextId += 1;
    return new Promise((resolvePromise, rejectPromise) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        rejectPromise(new Error(`CDP ${method} timed out.`));
      }, 30_000);
      this.pending.set(id, {
        resolve: (value) => {
          clearTimeout(timeout);
          resolvePromise(value);
        },
        reject: (error) => {
          clearTimeout(timeout);
          rejectPromise(error);
        },
      });
      this.webSocket.send(JSON.stringify({ id, method, params }));
    });
  }

  close() {
    this.webSocket.close();
  }
}

export async function fetchJson(url, timeout = 1_500) {
  const response = await fetch(url, { signal: AbortSignal.timeout(timeout) });
  if (!response.ok) throw new Error(`HTTP ${response.status} from ${url}`);
  return response.json();
}

export async function waitForTarget(port) {
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    try {
      const targets = await fetchJson(`http://127.0.0.1:${port}/json/list`);
      const page = targets.find(
        (target) =>
          target.type === "page" && target.url?.includes("index.html"),
      );
      if (page?.webSocketDebuggerUrl) return page;
    } catch {
      // Electron has not opened its debugging endpoint yet.
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 250));
  }
  throw new Error("Timed out waiting for the Desktop skin smoke page.");
}

export async function evaluate(connection, expression) {
  const result = await connection.send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (result.exceptionDetails) {
    throw new Error(
      [
        `Runtime.evaluate failed: ${result.exceptionDetails.text ?? "unknown"}`,
        result.exceptionDetails.exception?.description,
        `Expression: ${expression}`,
      ]
        .filter(Boolean)
        .join("\n"),
    );
  }
  return result.result?.value;
}

export async function waitFor(
  connection,
  expression,
  description,
  timeout = 30_000,
) {
  const deadline = Date.now() + timeout;
  let last;
  while (Date.now() < deadline) {
    last = await evaluate(connection, expression);
    if (last) return last;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 150));
  }
  throw new Error(
    `Timed out waiting for ${description}; last=${JSON.stringify(last)}`,
  );
}
