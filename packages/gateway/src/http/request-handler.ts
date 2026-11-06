import { createGatewayAdminRoutes } from "./admin-routes.js";
import { createGatewayDeviceRoutes } from "./device-routes.js";
import { readBody, respond } from "./http-response.js";

import { imText } from "../i18n/im-localization.js";

import {
  IM_SECURITY_VERSION,
  appLocaleSchema,
  isImOwnerDirectRequest,
} from "@artemis/protocol";

import { type IncomingMessage, type ServerResponse } from "node:http";

import { type RemoteInvocationContext } from "@artemis/protocol";
import { sameSecret } from "../store.js";

import {
  channelConnectionSchema,
  normalizeFeishu,
  verifyFeishu,
} from "../channels/channels.js";
import type { GatewayDependencies } from "../runtime/gateway-dependencies.js";
export function createGatewayRequestHandler(
  services: Pick<
    GatewayDependencies,
    | "router"
    | "store"
    | "receiveFeishuCard"
    | "approvalLocale"
    | "receiveFeishuGroup"
    | "receiveChannelEvent"
    | "options"
    | "adapters"
    | "install"
    | "visibleGroups"
    | "presenceRefreshAt"
    | "metadataJob"
    | "refreshNativeGroupInfo"
    | "tick"
    | "presenceJob"
    | "refreshDiscoveredGroupNames"
    | "mediaKey"
    | "cacheAttachments"
  >,
) {
  const handleAdmin = createGatewayAdminRoutes(services);
  const handleDevice = createGatewayDeviceRoutes(services);

  function identityStillBound(request: RemoteInvocationContext): boolean {
    return services.router.isInvocationAuthorized(request);
  }

  async function handle(
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    const url = new URL(request.url ?? "/", "http://gateway.local");
    if (url.pathname.startsWith("/artifacts/") && request.method === "GET") {
      const [, , id, capability] = url.pathname.split("/");
      const artifact = services.store.get<{
        name: string;
        data: string;
        token: string;
        expiresAt: number;
        invocationId: string;
      }>("artifacts", id ?? "");
      const invocation = artifact
        ? services.store.get<RemoteInvocationContext>(
            "invocations",
            artifact.invocationId,
          )
        : undefined;
      if (
        !artifact ||
        artifact.expiresAt <= Date.now() ||
        !sameSecret(capability ?? "", artifact.token) ||
        !invocation ||
        !handlers.identityStillBound(invocation) ||
        (!isImOwnerDirectRequest(invocation) &&
          !services.router.securityAllowed(
            services.store.get("invocation-security", invocation.id),
          ))
      ) {
        respond(response, 404, {
          error: "Artifact is unavailable or expired.",
        });
        return;
      }
      const data = Buffer.from(artifact.data, "base64");
      response.writeHead(200, {
        "Content-Type": "application/octet-stream",
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(artifact.name)}`,
        "Content-Length": data.length,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "no-referrer",
        "Content-Security-Policy": "default-src 'none'; sandbox",
      });
      response.end(data);
      return;
    }
    if (request.headers.origin)
      throw new Error("Browser-origin requests are not accepted.");
    if (url.pathname === "/health" && request.method === "GET") {
      respond(response, 200, {
        ok: true,
        version: 1,
        securityVersion: IM_SECURITY_VERSION,
        authorizationVersion: 1,
      });
      return;
    }
    if (
      url.pathname.startsWith("/channels/feishu/") &&
      request.method === "POST"
    ) {
      const id = url.pathname.slice("/channels/feishu/".length);
      const entry = services.store.get<{ sealed: string }>("connections", id);
      if (!entry) throw new Error("Unknown channel.");
      const config = channelConnectionSchema.parse(
        services.store.unseal(entry.sealed),
      );
      if (
        config.channel !== "feishu" ||
        !config.enabled ||
        config.transport === "websocket"
      )
        throw new Error("Channel is disabled.");
      const event = verifyFeishu(
        config,
        await readBody(request),
        request.headers,
      );
      if (event.type === "url_verification") {
        respond(response, 200, { challenge: event.challenge });
        return;
      }
      if (event.header?.event_type === "card.action.trigger") {
        const accepted = services.receiveFeishuCard(config.id, event);
        respond(response, 200, {
          toast: {
            type: accepted ? "success" : "error",
            content: imText(
              services.approvalLocale(config.id, event),
              accepted ? "approvalSubmitted" : "approvalInvalid",
            ),
          },
        });
        return;
      }
      services.receiveFeishuGroup(config, event);
      const normalized = normalizeFeishu(config, event);
      if (normalized) services.receiveChannelEvent(normalized);
      // ingest commits before acknowledging the platform.
      respond(response, 200, { code: 0 });
      return;
    }
    const token = request.headers.authorization?.replace(/^Bearer /u, "") ?? "";
    const parsedLocale = appLocaleSchema.safeParse(
      request.headers["x-artemis-locale"],
    );
    const locale = parsedLocale.success ? parsedLocale.data : "zh-CN";
    const clientInvocation = (invocation: RemoteInvocationContext) => {
      if (parsedLocale.success) return invocation;
      // Locale is opt-in: legacy desktops use a strict v1 request schema.
      const compatible = { ...invocation };
      delete compatible.locale;
      return compatible;
    };
    if (url.pathname.startsWith("/v1/admin/")) {
      return handleAdmin({
        request,
        response,
        url,
        token,
        locale,
        parsedLocale,
        clientInvocation,
        identityStillBound,
      });
    }
    return handleDevice({
      request,
      response,
      url,
      token,
      locale,
      parsedLocale,
      clientInvocation,
      identityStillBound,
    });
  }
  const handlers = { identityStillBound, handle };
  return handlers;
}
