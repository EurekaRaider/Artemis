import { expect, it, vi } from "vitest";

import type { ArtemisGateway } from "@artemis/gateway";

import { ImService } from "../../../../src/main/im/im-service.js";
import {
  cleanup,
  fixture,
  pendingReply,
} from "../../../fixtures/im/native-groups.js";
it("holds a credential result locally and approves the exact candidate only once without rerunning", async () => {
  const f = await pendingReply();
  const preview = await f.service.manage({
    action: "outbound-preview",
    id: f.item.id,
  });
  expect(JSON.stringify(preview)).toContain(f.secret);
  await expect(
    f.service.manage({
      action: "outbound-resolve",
      id: f.item.id,
      contentHash: "changed",
      approve: true,
    }),
  ).rejects.toThrow();
  const approval = {
    action: "outbound-resolve" as const,
    id: f.item.id,
    contentHash: f.item.contentHash,
    approve: true,
    text: "Reviewed safe result",
  };
  await f.service.manage(approval);
  await f.service.poll();
  await f.service.poll();
  await expect(f.service.manage(approval)).rejects.toThrow();
  expect(
    f.gateway.store
      .pending<{ text: string }>("outgoing")
      .filter((x) => x.payload.text.includes("Reviewed safe result")),
  ).toHaveLength(1);
  expect(f.starts).toHaveLength(1);
  expect(JSON.stringify(f.gateway.store.pending("outgoing"))).not.toContain(
    f.secret,
  );
});
it("retries an approved frozen reply after restart without duplicate delivery", async () => {
  const f = await pendingReply();
  await f.service.manage({
    action: "outbound-resolve",
    id: f.item.id,
    contentHash: f.item.contentHash,
    approve: true,
    text: "ONCE_AFTER_RESTART",
  });
  const originalFetch = globalThis.fetch;
  let lost = false;
  const fetchSpy = vi
    .spyOn(globalThis, "fetch")
    .mockImplementation(async (...args) => {
      const response = await originalFetch(...args);
      if (!lost && String(args[0]).endsWith("/v1/device/reply")) {
        lost = true;
        throw new Error("Acknowledgement lost");
      }
      return response;
    });
  await f.service.poll();
  fetchSpy.mockRestore();
  await f.service.close();
  const restored = new ImService(
    f.root,
    {
      isEncryptionAvailable: () => true,
      encryptString: (s) => Buffer.from(s),
      decryptString: (b) => b.toString(),
    },
    f.ops,
  );
  cleanup.push(() => restored.close());
  await restored.poll();
  await restored.poll();
  expect(
    (
      restored as unknown as { localGateway: { gateway: ArtemisGateway } }
    ).localGateway.gateway.store
      .pending<{ text: string }>("outgoing")
      .filter((x) => x.payload.text.includes("ONCE_AFTER_RESTART")),
  ).toHaveLength(1);
  expect(f.starts).toHaveLength(1);
});
it("invalidates pending deliveries when a scope changes but keeps the conversation", async () => {
  const f = await pendingReply();
  const oldId = f.threadId;
  await f.service.save({
    ...f.service.status().settings,
    grants: f.service.status().settings.grants.map((g) => ({
      ...g,
      security: {
        ...g.security!,
        scopes: g.security!.scopes.map((scope) => ({
          ...scope,
          readPaths: ["README.md"],
          filePaths: ["README.md"],
          writePaths: [],
        })),
      },
    })),
  });
  await expect(
    f.service.manage({
      action: "outbound-resolve",
      id: f.item.id,
      contentHash: f.item.contentHash,
      approve: true,
    }),
  ).rejects.toThrow();
  expect(() =>
    f.service.authorizeOperation(
      oldId,
      { action: "read", path: "README.md" },
      "plan",
    ),
  ).not.toThrow();
  expect(() =>
    f.service.authorizeOperation(
      oldId,
      { action: "read", path: "private.txt" },
      "plan",
    ),
  ).toThrow();
  await f.send("Continue after scope change");
  expect(f.threads).toHaveLength(2);
  expect(f.starts.at(-1)).toBe(oldId);
  expect(f.starts).toHaveLength(2);
  expect(JSON.stringify(f.gateway.store.pending("outgoing"))).not.toContain(
    f.secret,
  );
});
it("rejects an unconfirmed new group before creating any Gateway relationship", async () => {
  const f = await fixture();
  f.grant.security!.confirmedAt = 0;
  await expect(f.authorize()).rejects.toThrow();
  expect(f.gateway.store.list("native-groups")).toEqual([]);
  expect(f.service.status().settings.grants).toEqual([]);
  expect(f.threads).toEqual([]);
});
