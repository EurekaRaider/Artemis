import { describe, expect, it } from "vitest";
import {
  assertImGatewayUrl,
  channelEventSchema,
  imIdentityKey,
  imSettingsSchema,
  remoteInvocationSchema,
  requireImGrant,
} from "../src/im.js";

const identity = {
  channel: "wecom" as const,
  connectionId: "bot",
  tenantId: "corp",
  appId: "app",
  userId: "owner",
};
const request = remoteInvocationSchema.parse({
  version: 1,
  id: "request",
  deviceId: "desktop",
  identity,
  conversation: { connectionId: "bot", id: "owner", kind: "direct" },
  messageId: "message",
  text: "hello",
  expiresAt: 2000,
});
const settings = imSettingsSchema.parse({
  enabled: true,
  deviceId: "desktop",
  grants: [{ projectId: "project", expiresAt: 2000 }],
});
describe("IM trust boundary", () => {
  it("isolates identities by tenant, app and channel account", () => {
    expect(imIdentityKey(identity)).not.toBe(
      imIdentityKey({ ...identity, tenantId: "other" }),
    );
    expect(imIdentityKey(identity)).not.toBe(
      imIdentityKey({ ...identity, connectionId: "other" }),
    );
  });
  it("requires an enabled, unexpired grant for the authenticated destination", () => {
    expect(requireImGrant(settings, request, "project", 1000).mode).toBe(
      "plan",
    );
    expect(() => requireImGrant(settings, request, "project", 2000)).toThrow();
    expect(() =>
      requireImGrant({ ...settings, enabled: false }, request, "project", 1000),
    ).toThrow();
    expect(() =>
      requireImGrant(
        settings,
        { ...request, deviceId: "other" },
        "project",
        1000,
      ),
    ).toThrow();
    expect(() => requireImGrant(settings, request, "private", 1000)).toThrow();
  });
  it("does not let a direct-message grant authorize group work", () => {
    expect(() =>
      requireImGrant(
        settings,
        {
          ...request,
          conversation: { ...request.conversation, kind: "group" },
        },
        "project",
        1000,
      ),
    ).toThrow();
  });
  it("rejects incompatible envelopes and insecure gateway destinations", () => {
    expect(channelEventSchema.safeParse({ version: 2 }).success).toBe(false);
    for (const url of [
      "http://example.com",
      "https://user:secret@example.com",
      "file:///tmp/x",
      "https://example.com/?token=x",
    ])
      expect(() => assertImGatewayUrl(url)).toThrow();
    expect(assertImGatewayUrl("http://127.0.0.1:7447").port).toBe("7447");
  });
});
