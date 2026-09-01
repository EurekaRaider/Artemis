// 绑定存储：接口 + 内存实现（证据：plan §2.1）
// main 侧注入 AppStore/SQLite 实现（plan §4，表 im_bindings）

import type { ChannelBinding } from "./types.js";

export interface BindingStore {
  get(adapter: string, channelId: string): ChannelBinding | undefined;
  upsert(binding: ChannelBinding): void;
  remove(adapter: string, channelId: string): boolean;
  list(): ChannelBinding[];
  update(adapter: string, channelId: string, patch: Partial<ChannelBinding>): boolean;
}

export function bindingKey(adapter: string, channelId: string): string {
  return `${adapter}:${channelId}`;
}

export class MemoryBindingStore implements BindingStore {
  private readonly bindings = new Map<string, ChannelBinding>();

  get(adapter: string, channelId: string): ChannelBinding | undefined {
    return this.bindings.get(bindingKey(adapter, channelId));
  }

  upsert(binding: ChannelBinding): void {
    this.bindings.set(bindingKey(binding.adapter, binding.channelId), { ...binding });
  }

  remove(adapter: string, channelId: string): boolean {
    return this.bindings.delete(bindingKey(adapter, channelId));
  }

  list(): ChannelBinding[] {
    return [...this.bindings.values()].map((b) => ({ ...b }));
  }

  update(adapter: string, channelId: string, patch: Partial<ChannelBinding>): boolean {
    const existing = this.bindings.get(bindingKey(adapter, channelId));
    if (!existing) return false;
    this.bindings.set(bindingKey(adapter, channelId), { ...existing, ...patch });
    return true;
  }
}
