import { type ChannelEvent } from "@artemis/protocol";

import type { GatewayDependencies } from "./gateway-dependencies.js";
export function createGatewayMediaRuntime(
  services: Pick<GatewayDependencies, "store" | "mediaJobs" | "adapters">,
) {
  function startMediaJobs(): void {
    for (const item of services.store.pending<ChannelEvent>("media")) {
      if (services.mediaJobs.size >= 4) break;
      if (services.mediaJobs.has(item.id)) continue;
      const operation = handlers
        .cacheAttachments(item.payload)
        .then(() => {
          services.store.mark("media", item.id, "done");
        })
        .catch(() => {
          services.store.mark(
            "media",
            item.id,
            item.attempts >= 5 ? "failed" : "pending",
            Date.now() + 5000,
          );
        })
        .finally(() => {
          services.mediaJobs.delete(item.id);
        });
      services.mediaJobs.set(item.id, operation);
    }
  }

  function mediaKey(event: ChannelEvent, index: number): string {
    return JSON.stringify([
      event.identity.connectionId,
      event.messageId,
      index,
    ]);
  }

  async function cacheAttachments(event: ChannelEvent): Promise<void> {
    const adapter = services.adapters.get(event.identity.connectionId);
    if (!adapter) throw new Error("Channel is unavailable.");
    let size = 0;
    for (let index = 0; index < event.attachments.length; index++) {
      const key = handlers.mediaKey(event, index);
      if (services.store.get("media-cache", key)) continue;
      const media = await adapter.attachment(event, index);
      size += media.data.length;
      if (size > 20 * 1024 * 1024)
        throw new Error("Attachments exceed 20 MiB.");
      services.store.put("media-cache", key, {
        sealed: services.store.seal({
          data: media.data.toString("base64"),
          mimeType: media.mimeType,
          name: media.name,
        }),
        expiresAt: Date.now() + 86400000,
      });
    }
  }
  const handlers = { startMediaJobs, mediaKey, cacheAttachments };
  return handlers;
}
