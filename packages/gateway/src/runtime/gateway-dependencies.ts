import { type GatewayOptions } from "./gateway-options.js";
import type { AppLocale } from "@artemis/protocol";

import { type ChannelEvent } from "@artemis/protocol";
import { GatewayStore } from "../store.js";
import { GatewayRouter } from "../router.js";
import {
  type ChannelAdapter,
  type ChannelConnection,
} from "../channels/channels.js";
export interface GatewayDependencies {
  readonly store: GatewayStore;
  readonly router: GatewayRouter;
  startMediaJobs(): void;
  invalidateGroupRoster(connectionId: string, channel: string): void;
  readonly adapters: Map<string, ChannelAdapter>;
  readonly options: GatewayOptions;
  mediaJobs: Map<string, Promise<void>>;
  receiveFeishuCard(connectionId: string, value: unknown): boolean;
  approvalLocale(connectionId: string, value: unknown): AppLocale | undefined;
  receiveFeishuGroup(
    config: Extract<
      ChannelConnection,
      {
        channel: "feishu";
      }
    >,
    value: unknown,
  ): void;
  receiveChannelEvent(event: ChannelEvent): void;
  install(config: ChannelConnection): void;
  readonly visibleGroups: Map<string, number>;
  presenceRefreshAt: number;
  metadataJob: Promise<void> | undefined;
  refreshNativeGroupInfo(spaceId?: string): Promise<void>;
  tick(): Promise<void>;
  presenceJob: Promise<void> | undefined;
  refreshDiscoveredGroupNames(force?: boolean): Promise<void>;
  mediaKey(event: ChannelEvent, index: number): string;
  cacheAttachments(event: ChannelEvent): Promise<void>;
  delivering: boolean;
  refreshMemberPresence(): Promise<void>;
  groupNameRefresh: Promise<void> | undefined;
}
