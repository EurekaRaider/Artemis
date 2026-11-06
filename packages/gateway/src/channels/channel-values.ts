export function record(value: unknown): Record<string, any> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, any>)
    : {};
}

export function string(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export function parseObject(value: string): Record<string, any> {
  try {
    return record(JSON.parse(value));
  } catch {
    return {};
  }
}

export function splitImText(value: string, maxBytes = 3500): string[] {
  const parts: string[] = [];
  let part = "";
  let bytes = 0;
  for (const char of value) {
    const size = Buffer.byteLength(char);
    if (bytes + size > maxBytes) {
      parts.push(part);
      part = "";
      bytes = 0;
    }
    part += char;
    bytes += size;
  }
  if (part) parts.push(part);
  return parts;
}

export async function boundedResponse(response: Response): Promise<Buffer> {
  if (!response.ok)
    throw new Error(`Attachment download failed (${response.status}).`);
  if (Number(response.headers.get("content-length")) > 10 * 1024 * 1024)
    throw new Error("Attachment exceeds 10 MiB.");
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Empty attachment response.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.length;
      if (size > 10 * 1024 * 1024)
        throw new Error("Attachment exceeds 10 MiB.");
      chunks.push(next.value);
    }
  } finally {
    await reader.cancel();
  }
  return Buffer.concat(chunks);
}

export function validateMentionUserId(value: string): string {
  if (
    !/^[a-zA-Z0-9_.@-]+$/u.test(value) ||
    /^(?:@?all|here|everyone)$/iu.test(value)
  )
    throw new Error("Invalid mention identity.");
  return value;
}
