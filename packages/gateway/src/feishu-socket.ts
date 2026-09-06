import { Domain, EventDispatcher, WSClient } from "@larksuiteoapi/node-sdk";
import type { ChannelEvent } from "@artemis/protocol";
import {
  FeishuAdapter,
  normalizeFeishu,
  type ChannelConnection,
  type ChannelStatus,
} from "./channels.js";

type Socket = Pick<WSClient, "start" | "close" | "getConnectionStatus">;
type SocketFactory = (
  options: ConstructorParameters<typeof WSClient>[0],
) => Socket;

// SDK diagnostics can contain credentials, URLs and complete incoming messages.
// Publish only the adapter's bounded status; never forward SDK log arguments.
const silentLogger = {
  trace() {},
  debug() {},
  info() {},
  warn() {},
  error() {},
};

/** Platform transport only. The receiver synchronously commits to Gateway's queue. */
export class FeishuSocketAdapter extends FeishuAdapter {
  private socket: Socket | undefined;
  private ingestionError = false;
  private connectionError = false;
  constructor(
    config: Extract<ChannelConnection, { channel: "feishu" }>,
    private readonly receive: (event: ChannelEvent) => void,
    private readonly createSocket: SocketFactory = (options) =>
      new WSClient(options),
    private readonly receiveCard?: (value: unknown) => boolean,
  ) {
    super(config);
  }

  override start(): void {
    if (!this.config.enabled || this.socket) return;
    this.ingestionError = false;
    this.connectionError = false;
    const socket = this.createSocket({
      appId: this.config.appId,
      appSecret: this.config.appSecret,
      domain: this.config.domain === "lark" ? Domain.Lark : Domain.Feishu,
      autoReconnect: true,
      handshakeTimeoutMs: 15000,
      wsConfig: { pingTimeout: 30 },
      logger: silentLogger,
    });
    this.socket = socket;
    const dispatcher = new EventDispatcher({ logger: silentLogger }).register({
      "card.action.trigger": async (data: unknown) => {
        if (this.socket !== socket) return;
        const input = data as {
          app_id?: string;
          tenant_key?: string;
          event_id?: string;
        };
        if (
          input.app_id !== this.config.appId ||
          input.tenant_key !== this.config.tenantId
        )
          return;
        try {
          const accepted = this.receiveCard?.({
            header: {
              event_type: "card.action.trigger",
              event_id: input.event_id,
              app_id: input.app_id,
              tenant_key: input.tenant_key,
            },
            event: input,
          });
          this.ingestionError = false;
          return {
            toast: {
              type: accepted ? "success" : "error",
              content: accepted
                ? "已提交，等待桌面确认。"
                : "此审批无效、已处理或已过期。",
            },
          };
        } catch {
          this.ingestionError = true;
          throw new Error(
            "Feishu event could not be saved. Check Gateway storage.",
          );
        }
      },
      "im.message.receive_v1": async (data) => {
        if (this.socket !== socket) return;
        // EventDispatcher flattens the v2 header and event. Both identity fields
        // must originate in this authenticated subscription, never configuration fallback.
        const input = data as typeof data & {
          app_id?: string;
          tenant_key?: string;
        };
        if (
          input.app_id !== this.config.appId ||
          input.tenant_key !== this.config.tenantId
        )
          return;
        const event = normalizeFeishu(this.config, {
          header: { event_type: "im.message.receive_v1" },
          event: input,
        });
        if (!event) return;
        try {
          this.receive(event);
          this.ingestionError = false;
        } catch {
          this.ingestionError = true;
          // Rejecting the dispatcher yields a failed SDK acknowledgement. No
          // in-memory dedup may swallow a platform retry after this failure.
          throw new Error(
            "Feishu event could not be saved. Check Gateway storage.",
          );
        }
      },
    });
    void socket.start({ eventDispatcher: dispatcher }).catch(() => {
      if (this.socket === socket) this.connectionError = true;
    });
  }
  override stop(): void {
    const socket = this.socket;
    this.socket = undefined;
    socket?.close({ force: true });
    this.ingestionError = false;
    this.connectionError = false;
    super.stop();
  }
  override status(): ChannelStatus {
    const lifecycle = this.socket?.getConnectionStatus().state;
    const error = this.ingestionError
      ? "Feishu event could not be saved. Check Gateway storage."
      : lifecycle === "failed" || this.connectionError
        ? `无法连接 ${this.config.domain === "lark" ? "Lark（open.larksuite.com）" : "飞书（open.feishu.cn）"}。请核对应用区域与 App ID / App Secret；Lark 国际版应用需选择 Lark。区域选错时请移除连接后重新配置。确认机器人已启用，再配置长连接事件订阅。 / ${this.config.domain === "lark" ? "Lark" : "Feishu"} long connection failed. Check app region and credentials; remove and recreate the connection if the region is wrong, then enable the bot and configure long connection events.`
        : undefined;
    return {
      id: this.config.id,
      name: this.config.name,
      channel: "feishu",
      state: !this.socket
        ? "disabled"
        : error
          ? "error"
          : lifecycle === "connected"
            ? "connected"
            : "connecting",
      ...(error ? { error } : {}),
    };
  }
}
