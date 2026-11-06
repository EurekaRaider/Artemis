import { type IncomingMessage, type ServerResponse } from "node:http";

export async function readBody(request: IncomingMessage): Promise<string> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > (request.url === "/v1/device/artifacts" ? 14 : 2) * 1024 * 1024)
      throw new Error("Request exceeds 2 MiB.");
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

export function respond(
  response: ServerResponse,
  code: number,
  body: unknown,
): void {
  response.writeHead(code, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(JSON.stringify(body));
}
