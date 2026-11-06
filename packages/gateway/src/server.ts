import type { GatewayDependencies } from "./runtime/gateway-dependencies.js";
import { createGatewayGroupRuntime } from "./runtime/group-runtime.js";
import { createGatewayDeliveryRuntime } from "./runtime/delivery-runtime.js";
import { createGatewayRequestHandler } from "./http/request-handler.js";
import { createGatewayMediaRuntime } from "./runtime/media-runtime.js";
import { createGatewayChannelRuntime } from "./runtime/channel-runtime.js";
import { respond } from "./http/http-response.js";
import { type GatewayOptions } from "./runtime/gateway-options.js";
import { retireKnownGroups } from "./groups/group-retirement.js";

import type { AppLocale } from "@artemis/protocol";

import { retireLegacySpaces } from "./groups/native-groups.js";

import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";

import {
  type ChannelEvent,
  type RemoteInvocationContext,
} from "@artemis/protocol";
import { GatewayStore } from "./store.js";
import { GatewayRouter } from "./router.js";

import {
  type ChannelAdapter,
  type ChannelConnection,
} from "./channels/channels.js";

/** Single-instance, durable HTTP transport. Desktop polling only claims work after local persistence. */
export class ArtemisGateway {
  private readonly gatewayChannelRuntime = createGatewayChannelRuntime(
    this.runtimeDependencies(),
  );
  private readonly gatewayMediaRuntime = createGatewayMediaRuntime(
    this.runtimeDependencies(),
  );
  private readonly gatewayRequestHandler = createGatewayRequestHandler(
    this.runtimeDependencies(),
  );
  private readonly gatewayDeliveryRuntime = createGatewayDeliveryRuntime(
    this.runtimeDependencies(),
  );
  private readonly gatewayGroupRuntime = createGatewayGroupRuntime(
    this.runtimeDependencies(),
  );
  private runtimeDependencies(): GatewayDependencies {
    const host = this;
    return {
      get store() {
        return host.store;
      },
      get router() {
        return host.router;
      },
      startMediaJobs: this.startMediaJobs.bind(this),
      invalidateGroupRoster: this.invalidateGroupRoster.bind(this),
      get adapters() {
        return host.adapters;
      },
      get options() {
        return host.options;
      },
      get mediaJobs() {
        return host.mediaJobs;
      },
      set mediaJobs(value: GatewayDependencies["mediaJobs"]) {
        host.mediaJobs = value;
      },
      receiveFeishuCard: this.receiveFeishuCard.bind(this),
      approvalLocale: this.approvalLocale.bind(this),
      receiveFeishuGroup: this.receiveFeishuGroup.bind(this),
      receiveChannelEvent: this.receiveChannelEvent.bind(this),
      install: this.install.bind(this),
      get visibleGroups() {
        return host.visibleGroups;
      },
      get presenceRefreshAt() {
        return host.presenceRefreshAt;
      },
      set presenceRefreshAt(value: GatewayDependencies["presenceRefreshAt"]) {
        host.presenceRefreshAt = value;
      },
      get metadataJob() {
        return host.metadataJob;
      },
      set metadataJob(value: GatewayDependencies["metadataJob"]) {
        host.metadataJob = value;
      },
      refreshNativeGroupInfo: this.refreshNativeGroupInfo.bind(this),
      tick: this.tick.bind(this),
      get presenceJob() {
        return host.presenceJob;
      },
      set presenceJob(value: GatewayDependencies["presenceJob"]) {
        host.presenceJob = value;
      },
      refreshDiscoveredGroupNames: this.refreshDiscoveredGroupNames.bind(this),
      mediaKey: this.mediaKey.bind(this),
      cacheAttachments: this.cacheAttachments.bind(this),
      get delivering() {
        return host.delivering;
      },
      set delivering(value: GatewayDependencies["delivering"]) {
        host.delivering = value;
      },
      refreshMemberPresence: this.refreshMemberPresence.bind(this),
      get groupNameRefresh() {
        return host.groupNameRefresh;
      },
      set groupNameRefresh(value: GatewayDependencies["groupNameRefresh"]) {
        host.groupNameRefresh = value;
      },
    };
  }

  readonly store: GatewayStore;
  readonly router: GatewayRouter;
  readonly server = createServer((request, response) => {
    void this.handle(request, response).catch((error) => {
      if (!response.headersSent)
        respond(response, 400, {
          error: error instanceof Error ? error.message : "Invalid request.",
        });
      else response.destroy();
    });
  });
  private readonly adapters = new Map<string, ChannelAdapter>();
  private timer: ReturnType<typeof setInterval> | undefined;
  private delivering = false;
  private metadataJob: Promise<void> | undefined;
  private presenceJob: Promise<void> | undefined;
  private readonly visibleGroups = new Map<string, number>();
  private presenceRefreshAt = 0;
  private mediaJobs = new Map<string, Promise<void>>();
  constructor(private readonly options: GatewayOptions) {
    if (options.adminToken.length < 32)
      throw new Error(
        "Gateway admin token must contain at least 32 characters.",
      );
    this.store = new GatewayStore(options.databasePath, options.encryptionKey);
    retireLegacySpaces(
      this.store,
      options.databasePath === ":memory:"
        ? undefined
        : `${options.databasePath}.pre-native-groups.sqlite`,
    );
    retireKnownGroups(this.store);
    this.router = new GatewayRouter(this.store);
    this.server.requestTimeout = 35000;
    this.server.headersTimeout = 10000;
    for (const sealed of this.store.list<{ id: string; sealed: string }>(
      "connections",
    ))
      this.install(this.store.unseal<ChannelConnection>(sealed.sealed));
  }
  private receiveChannelEvent(event: ChannelEvent): void {
    return this.gatewayChannelRuntime.receiveChannelEvent(event);
  }
  private receiveFeishuGroup(
    config: Extract<ChannelConnection, { channel: "feishu" }>,
    value: unknown,
  ): void {
    return this.gatewayChannelRuntime.receiveFeishuGroup(config, value);
  }
  private approvalLocale(
    connectionId: string,
    value: unknown,
  ): AppLocale | undefined {
    return this.gatewayChannelRuntime.approvalLocale(connectionId, value);
  }
  private receiveFeishuCard(connectionId: string, value: unknown): boolean {
    return this.gatewayChannelRuntime.receiveFeishuCard(connectionId, value);
  }
  private startMediaJobs(): void {
    return this.gatewayMediaRuntime.startMediaJobs();
  }
  private mediaKey(event: ChannelEvent, index: number): string {
    return this.gatewayMediaRuntime.mediaKey(event, index);
  }
  private cacheAttachments(event: ChannelEvent): Promise<void> {
    return this.gatewayMediaRuntime.cacheAttachments(event);
  }
  private install(config: ChannelConnection): void {
    return this.gatewayChannelRuntime.install(config);
  }
  /** Pin a websocket-adopted tenant key into the sealed connection config. */
  private persistTenantId(id: string, tenantId: string): void {
    return this.gatewayChannelRuntime.persistTenantId(id, tenantId);
  }
  async listen(port = 8787, host = "127.0.0.1"): Promise<number> {
    await new Promise<void>((resolve, reject) => {
      this.server.once("error", reject);
      this.server.listen(port, host, () => {
        this.server.off("error", reject);
        resolve();
      });
    });
    this.timer = setInterval(() => {
      void this.tick();
    }, 1000);
    const address = this.server.address();
    if (!address || typeof address === "string")
      throw new Error("Gateway failed to listen.");
    return address.port;
  }
  async close(): Promise<void> {
    clearInterval(this.timer);
    await new Promise<void>((resolve) => this.server.close(() => resolve()));
    while (this.delivering)
      await new Promise((resolve) => setTimeout(resolve, 10));
    await this.updateTyping(true);
    for (const adapter of this.adapters.values()) adapter.stop();
    await Promise.allSettled(
      [...this.mediaJobs.values(), this.metadataJob, this.presenceJob].filter(
        (job): job is Promise<void> => !!job,
      ),
    );
    this.store.close();
  }
  private identityStillBound(request: RemoteInvocationContext): boolean {
    return this.gatewayRequestHandler.identityStillBound(request);
  }
  private handle(
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    return this.gatewayRequestHandler.handle(request, response);
  }
  tick(): Promise<void> {
    return this.gatewayDeliveryRuntime.tick();
  }
  private groupNameRefresh: Promise<void> | undefined;
  private refreshDiscoveredGroupNames(force = false): Promise<void> {
    return this.gatewayGroupRuntime.refreshDiscoveredGroupNames(force);
  }
  private queryDiscoveredGroupNames(force: boolean): Promise<void> {
    return this.gatewayGroupRuntime.queryDiscoveredGroupNames(force);
  }
  private invalidateGroupRoster(connectionId: string, channel: string): void {
    return this.gatewayGroupRuntime.invalidateGroupRoster(
      connectionId,
      channel,
    );
  }
  private refreshMemberPresence(): Promise<void> {
    return this.gatewayGroupRuntime.refreshMemberPresence();
  }
  private refreshNativeGroupInfo(spaceId?: string): Promise<void> {
    return this.gatewayGroupRuntime.refreshNativeGroupInfo(spaceId);
  }
  private closeApprovalCards(): Promise<void> {
    return this.gatewayDeliveryRuntime.closeApprovalCards();
  }
  private updateTyping(stopping = false): Promise<void> {
    return this.gatewayDeliveryRuntime.updateTyping(stopping);
  }
}

export { type GatewayOptions } from "./runtime/gateway-options.js";
