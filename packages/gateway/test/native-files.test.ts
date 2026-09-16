import { EventEmitter } from "node:events";
import { afterEach, expect, it, vi } from "vitest";
import {
  FeishuAdapter,
  WecomAdapter,
  DeliveryUncertain,
} from "../src/channels.js";
import { SlackAdapter } from "../src/slack.js";
const frames = vi.hoisted(() => [] as Array<{ cmd: string; body: any }>);
vi.mock("ws", () => ({
  default: class extends EventEmitter {
    static OPEN = 1;
    readyState = 1;
    constructor() {
      super();
      queueMicrotask(() => this.emit("open"));
    }
    send(data: string) {
      const frame = JSON.parse(data);
      frames.push(frame);
      queueMicrotask(() =>
        this.emit(
          "message",
          Buffer.from(
            JSON.stringify({
              headers: frame.headers,
              errcode: 0,
              body:
                frame.cmd === "aibot_upload_media_init"
                  ? { upload_id: "upload" }
                  : frame.cmd === "aibot_upload_media_finish"
                    ? { media_id: "media" }
                    : {},
            }),
          ),
        ),
      );
    }
    close() {}
    terminate() {}
  },
}));
afterEach(() => {
  vi.unstubAllGlobals();
  frames.length = 0;
});
const conversation = {
  connectionId: "bot",
  kind: "group" as const,
  id: "room",
};
const file = { name: "result.txt", data: Buffer.from("result") };
const common = { id: "bot", name: "Bot", tenantId: "tenant", enabled: true };
const slack = () =>
  new SlackAdapter(
    {
      ...common,
      channel: "slack",
      appId: "app",
      botUserId: "user",
      botToken: "xoxb-token",
      appToken: "xapp-token",
    },
    () => {},
  );
const feishu = (domain: "feishu" | "lark") =>
  new FeishuAdapter({
    ...common,
    channel: "feishu",
    appId: "app",
    botOpenId: "bot",
    appSecret: "secret",
    domain,
  });
for (const domain of ["feishu", "lark"] as const)
  it(`${domain} uploads a native file and rechecks authorization before posting`, async () => {
    const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes("tenant_access_token"))
        return Response.json({
          code: 0,
          tenant_access_token: "token",
          expire: 7200,
        });
      if (url.endsWith("/files")) {
        expect(init?.body).toBeInstanceOf(FormData);
        return Response.json({ code: 0, data: { file_key: "file" } });
      }
      expect(JSON.parse(String(init?.body))).toMatchObject({
        receive_id: "room",
        msg_type: "file",
        content: JSON.stringify({ file_key: "file" }),
      });
      return Response.json({ code: 0, data: { message_id: "message" } });
    });
    vi.stubGlobal("fetch", fetcher);
    const authorize = vi.fn();
    expect(
      await feishu(domain).publish(conversation, file, "key", authorize),
    ).toBe("message");
    expect(authorize).toHaveBeenCalledTimes(4);
    expect(
      fetcher.mock.calls.every(([url]) =>
        url.startsWith(
          domain === "lark"
            ? "https://open.larksuite.com/"
            : "https://open.feishu.cn/",
        ),
      ),
    ).toBe(true);
    fetcher.mockClear();
    await expect(
      feishu(domain).publish(
        conversation,
        file,
        "key",
        vi
          .fn()
          .mockImplementationOnce(() => {})
          .mockImplementation(() => {
            throw new Error("revoked");
          }),
      ),
    ).rejects.toThrow("revoked");
    expect(fetcher.mock.calls.some(([url]) => url.includes("/messages"))).toBe(
      false,
    );
  });
it("Slack restricts upload URLs and never repeats an uncertain public completion", async () => {
  const fetcher = vi.fn(async (url: string | URL) => {
    if (String(url).endsWith("files.getUploadURLExternal"))
      return Response.json({
        ok: true,
        upload_url: "https://evil.example/upload",
        file_id: "F1",
      });
    throw new Error("Unexpected network access");
  });
  vi.stubGlobal("fetch", fetcher);
  await expect(
    slack().publish(conversation, file, "key", () => {}),
  ).rejects.toThrow("invalid upload");
  expect(fetcher).toHaveBeenCalledTimes(1);
  fetcher.mockReset().mockImplementation(async (url: string | URL) => {
    if (String(url).endsWith("files.getUploadURLExternal"))
      return Response.json({
        ok: true,
        upload_url: "https://files.slack.com/upload/v1/test",
        file_id: "F1",
      });
    if (String(url).includes("/upload/")) return new Response("");
    throw new Error("connection lost after submission");
  });
  await expect(
    slack().publish(conversation, file, "key", () => {}),
  ).rejects.toBeInstanceOf(DeliveryUncertain);
  expect(fetcher).toHaveBeenCalledTimes(3);
});
it("WeCom uploads bounded chunks and sends the media to exactly the bound group", async () => {
  const adapter = new WecomAdapter(
    { ...common, channel: "wecom", botId: "bot", secret: "secret" },
    () => {},
  );
  adapter.start();
  try {
    await vi.waitFor(() => expect(adapter.status().state).toBe("connected"));
    await adapter.publish(
      conversation,
      { ...file, data: Buffer.alloc(512 * 1024 + 1, 65) },
      "key",
      () => {},
    );
    const chunks = frames.filter((f) => f.cmd === "aibot_upload_media_chunk");
    expect(chunks.map((c) => c.body.chunk_index)).toEqual([0, 1]);
    expect(
      chunks.map((c) => Buffer.from(c.body.base64_data, "base64").length),
    ).toEqual([512 * 1024, 1]);
    expect(frames.at(-1)).toMatchObject({
      cmd: "aibot_send_msg",
      body: { chatid: "room", msgtype: "file", file: { media_id: "media" } },
    });
  } finally {
    adapter.stop();
  }
});
