// IMManager 的 BindingStore 接口的 AppStore 实现（证据 E9：plan §4）
// 把 packages/im 的平台无关绑定模型映射到 im_bindings SQL 表。

import type { BindingStore } from "@artemis/im";
import type { ChannelBinding, OutputMode, Platform } from "@artemis/im";

import type { AppStore, ImBindingRecord } from "./store.js";

function recordToBinding(record: ImBindingRecord): ChannelBinding {
  return {
    workspaceKey: record.workspaceKey,
    threadId: record.threadId,
    adapter: record.adapter,
    platform: record.platform as Platform,
    channelId: record.channelId,
    outputMode: record.outputMode,
    muted: record.muted,
    boundAt: record.boundAt,
    ...(record.lastInboundMessageId !== undefined
      ? { lastInboundMessageId: record.lastInboundMessageId }
      : {}),
  };
}

export class AppStoreBindingStore implements BindingStore {
  constructor(private readonly store: AppStore) {}

  get(adapter: string, channelId: string): ChannelBinding | undefined {
    const record = this.store.getImBinding(adapter, channelId);
    return record ? recordToBinding(record) : undefined;
  }

  upsert(binding: ChannelBinding): void {
    this.store.upsertImBinding({
      workspaceKey: binding.workspaceKey,
      threadId: binding.threadId,
      adapter: binding.adapter,
      platform: binding.platform,
      channelId: binding.channelId,
      outputMode: binding.outputMode,
      muted: binding.muted,
      boundAt: binding.boundAt,
      ...(binding.lastInboundMessageId !== undefined
        ? { lastInboundMessageId: binding.lastInboundMessageId }
        : {}),
    });
  }

  remove(adapter: string, channelId: string): boolean {
    return this.store.deleteImBinding(adapter, channelId);
  }

  list(): ChannelBinding[] {
    return this.store.listImBindings().map(recordToBinding);
  }

  update(adapter: string, channelId: string, patch: Partial<ChannelBinding>): boolean {
    const sqlPatch: Parameters<AppStore["updateImBinding"]>[2] = {};
    if (patch.threadId !== undefined) sqlPatch.threadId = patch.threadId;
    if (patch.outputMode !== undefined)
      sqlPatch.outputMode = patch.outputMode as OutputMode;
    if (patch.muted !== undefined) sqlPatch.muted = patch.muted;
    if (patch.lastInboundMessageId !== undefined)
      sqlPatch.lastInboundMessageId = patch.lastInboundMessageId;
    return this.store.updateImBinding(adapter, channelId, sqlPatch);
  }
}
