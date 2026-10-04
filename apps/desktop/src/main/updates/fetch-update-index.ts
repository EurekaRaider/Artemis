import {
  verifyUpdateIndex,
  type UpdateIndexPayload,
} from "./signed-update-index.js";
export async function fetchUpdateIndex(
  url: string,
  keys: Record<string, string>,
  minimumSequence = 0,
  fetcher: typeof fetch = fetch,
): Promise<UpdateIndexPayload> {
  const response = await fetcher(url, {
    credentials: "omit",
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok || !response.body)
    throw new Error(`Update index HTTP ${response.status}`);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.length;
      if (size > 65536) throw new Error("Update index exceeds 64 KiB");
      chunks.push(chunk.value);
    }
  } finally {
    await reader.cancel();
    reader.releaseLock();
  }
  return verifyUpdateIndex(Buffer.concat(chunks), keys, minimumSequence);
}
