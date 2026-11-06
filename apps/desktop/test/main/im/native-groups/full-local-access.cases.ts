import { writeFile } from "node:fs/promises";

import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { expect, it, vi } from "vitest";
import {
  imAuthorizationFingerprint,
  imPolicyVersion,
  imAuthorizationImpactVersion,
  type ImAuthorizationCommand,
  type ImAuthorizationOperation,
  type ImOutboundCandidate,
  type AgentEvent,
} from "@artemis/protocol";

import * as localAccess from "../../../../src/main/im/im-local-access.js";
import { imContentHash } from "../../../../src/main/im/im-policy.js";

import {
  fixture,
  authorizationCommand,
} from "../../../fixtures/im/native-groups.js";
it("requires explicit full-local confirmation before creating a group grant", async () => {
  const f = await fixture();
  const command = authorizationCommand(f);
  Object.assign(command.scope, { localAccess: "full" });
  command.confirmationFingerprint = imAuthorizationFingerprint(command);
  await expect(
    f.service.manage({ action: "authorize-group", command }),
  ).rejects.toThrow(/full|完整/i);
  expect(f.service.status().authorizationOperations).toEqual([]);
  expect(f.gateway.store.list("native-groups")).toEqual([]);
});
it("runs confirmed full-local operations through the group broker and revokes them per scope", async () => {
  const f = await fixture();
  const command = authorizationCommand(f);
  Object.assign(command.scope, { localAccess: "full" });
  Object.assign(command, { fullAccessConfirmed: true });
  command.policy!.mode = "work";
  command.confirmationFingerprint = imAuthorizationFingerprint(command);
  const result = (await f.service.manage({
    action: "authorize-group",
    command,
  })) as ImAuthorizationOperation;
  expect(result.state).toBe("complete");
  await f.service.accept(
    f.gateway.router.groupConversationContext(
      command.deviceId,
      result.group!.id,
    ),
  );
  const threadId = f.threads.at(-1)!.id;
  expect(
    f.service.authorizeOperation(
      threadId,
      { action: "shell", command: "echo ok", timeoutSeconds: 5 },
      "work",
    ).approval,
  ).toBe("automatic");
  expect(f.service.status().settings.grants[0]!.approval).toBe("ask");
  const outside = join(f.root, "outside.txt");
  await writeFile(outside, "outside content");
  expect(f.service.profile(threadId)).toMatchObject({
    shell: true,
    network: true,
    dataScope: { localAccess: "full" },
  });
  expect(() =>
    f.service.authorizeOperation(
      threadId,
      { action: "write", path: outside, content: "x" },
      "plan",
    ),
  ).toThrow(/Plan|Review/);
  expect(
    await f.service.operate(
      threadId,
      { action: "read", path: outside },
      "work",
      "full-read",
    ),
  ).toMatchObject({ output: "outside content" });
  expect(
    await f.service.operate(
      threadId,
      { action: "write", path: outside, content: "updated" },
      "work",
      "full-write",
    ),
  ).toMatchObject({ exitCode: 0 });
  expect(
    await f.service.operate(
      threadId,
      {
        action: "shell",
        command:
          process.platform === "win32"
            ? "Write-Output full-local-ok"
            : "printf full-local-ok",
        timeoutSeconds: 5,
      },
      "work",
      "full-shell",
    ),
  ).toMatchObject({
    output: expect.stringContaining("full-local-ok"),
    exitCode: 0,
  });
  const settings = f.service.status().settings;
  const grant = settings.grants[0]!;
  const scope = grant.security!.scopes.find(
    (s) => s.audience === `space:${result.group!.id}`,
  )!;
  const edit: ImAuthorizationCommand = {
    ...command,
    operationId: randomUUID(),
    intent: "edit",
    policy: undefined,
    fullAccessConfirmed: undefined,
    scope: { ...scope, localAccess: "project" },
    expectedPolicyVersion: imPolicyVersion(grant),
    expectedGroupVersion: result.group!.revision!,
    expectedScopeVersion: scope.revision!,
    expectedDeviceEnabled: settings.enabled,
    expectedImpactVersion: imAuthorizationImpactVersion(
      settings,
      "p",
      false,
      true,
    ),
  };
  edit.confirmationFingerprint = imAuthorizationFingerprint(edit);
  expect(
    (
      (await f.service.manage({
        action: "authorize-group",
        command: edit,
      })) as ImAuthorizationOperation
    ).state,
  ).toBe("complete");
  expect(() =>
    f.service.authorizeOperation(
      threadId,
      { action: "read", path: outside },
      "work",
    ),
  ).toThrow();
  expect(f.service.profile(threadId)?.shell).toBe(false);
});
it("does not grant full-local access through legacy settings or another bot in the same project", async () => {
  const f = await fixture();
  Object.assign(f.grant.security!.scopes[0]!, { localAccess: "full" });
  await expect(f.authorize()).rejects.toThrow(/confirmed group/);
  await expect(
    f.service.save({ ...f.service.status().settings, grants: [f.grant] }),
  ).rejects.toThrow(/confirmed group/);
  const first = authorizationCommand(f);
  first.scope.localAccess = "full";
  first.fullAccessConfirmed = true;
  first.confirmationFingerprint = imAuthorizationFingerprint(first);
  const created = (await f.service.manage({
    action: "authorize-group",
    command: first,
  })) as ImAuthorizationOperation;
  const otherIdentity = {
    ...f.event.identity,
    connectionId: "second-bot",
    appId: "second-app",
  };
  const pair = (await f.service.manage({ action: "pair" })) as { code: string };
  f.gateway.store.pair(pair.code, otherIdentity);
  const otherEvent = {
    ...f.event,
    messageId: randomUUID(),
    identity: otherIdentity,
    conversation: { ...f.event.conversation, connectionId: "second-bot" },
  };
  f.gateway.router.ingest(otherEvent);
  f.gateway.router.processIncoming();
  await f.service.manage({ action: "refresh" });
  const settings = f.service.status().settings;
  const other: ImAuthorizationCommand = {
    ...authorizationCommand(f),
    conversation: otherEvent.conversation,
    owner: otherIdentity,
    policy: undefined,
    expectedPolicyVersion: imPolicyVersion(settings.grants[0]),
    expectedImpactVersion: imAuthorizationImpactVersion(
      settings,
      "p",
      false,
      true,
    ),
  };
  other.confirmationFingerprint = imAuthorizationFingerprint(other);
  const second = (await f.service.manage({
    action: "authorize-group",
    command: other,
  })) as ImAuthorizationOperation;
  expect(second.state).toBe("complete");
  const scopes = f.service.status().settings.grants[0]!.security!.scopes;
  expect(
    scopes.find((s) => s.audience === `space:${created.group!.id}`)
      ?.localAccess,
  ).toBe("full");
  expect(
    scopes.find((s) => s.audience === `space:${second.group!.id}`)?.localAccess,
  ).toBeUndefined();
  await f.service.accept(
    f.gateway.router.groupConversationContext(other.deviceId, second.group!.id),
  );
  expect(
    f.service.authorizeOperation(
      f.threads.at(-1)!.id,
      { action: "participants" },
      "plan",
    ).approval,
  ).toBe("ask");
  expect(() =>
    f.service.authorizeOperation(
      f.threads.at(-1)!.id,
      { action: "read", path: join(f.root, "outside.txt") },
      "plan",
    ),
  ).toThrow();
});
it("sends full-local results automatically and requires fresh confirmation on permission edits", async () => {
  const f = await fixture();
  const command = authorizationCommand(f);
  command.scope.localAccess = "full";
  command.fullAccessConfirmed = true;
  command.confirmationFingerprint = imAuthorizationFingerprint(command);
  const created = (await f.service.manage({
    action: "authorize-group",
    command,
  })) as ImAuthorizationOperation;
  await f.service.accept({
    ...f.gateway.router.groupConversationContext(
      command.deviceId,
      created.group!.id,
    ),
    id: randomUUID(),
    text: "read the external file",
  });
  const threadId = f.threads.at(-1)!.id;
  const outside = join(f.root, "private-result.txt");
  await writeFile(outside, "synthetic private result");
  await f.service.operate(
    threadId,
    { action: "read", path: outside },
    "plan",
    "private-read",
  );
  const event: AgentEvent = {
    protocolVersion: 4,
    seq: 1,
    eventId: randomUUID(),
    threadId,
    turnId: "private-turn",
    timestamp: new Date().toISOString(),
    payload: {
      type: "turn.failed",
      message:
        "synthetic private result ![synthetic](https://example.invalid/image.png)",
    },
  };
  f.service.observe([event]);
  const pending = (await f.service.manage({
    action: "outbound-list",
  })) as ImOutboundCandidate[];
  expect(pending.some((c) => c.threadId === threadId)).toBe(false);
  const db = new DatabaseSync(join(f.root, "im.sqlite"));
  try {
    const outbox = db
      .prepare("SELECT value FROM im_state WHERE namespace='outbox'")
      .all();
    expect(JSON.stringify(outbox)).toContain("synthetic private result");
  } finally {
    db.close();
  }
  const changed = {
    ...command,
    operationId: randomUUID(),
    intent: "edit" as const,
    fullAccessConfirmed: false,
  };
  changed.confirmationFingerprint = imAuthorizationFingerprint(changed);
  await expect(
    f.service.manage({ action: "authorize-group", command: changed }),
  ).rejects.toThrow(/confirmation/);
});
it.each(["current", "stale", "expired", "project"] as const)(
  "recovers a legacy pending result only for the same live full-local authorization (%s)",
  async (state) => {
    const f = await fixture();
    const command = authorizationCommand(f);
    if (state !== "project") {
      command.scope.localAccess = "full";
      command.fullAccessConfirmed = true;
    }
    command.confirmationFingerprint = imAuthorizationFingerprint(command);
    const created = (await f.service.manage({
      action: "authorize-group",
      command,
    })) as ImAuthorizationOperation;
    await f.service.accept(
      f.gateway.router.groupConversationContext(
        command.deviceId,
        created.group!.id,
      ),
    );
    const threadId = f.threads.at(-1)!.id;
    const db = new DatabaseSync(join(f.root, "im.sqlite"));
    try {
      const binding = JSON.parse(
        String(
          db
            .prepare(
              "SELECT value FROM im_state WHERE namespace='bindings' AND id=?",
            )
            .get(threadId)!.value,
        ),
      );
      const id = randomUUID();
      const reply = {
        version: 1,
        id,
        taskId: threadId,
        invocationId: binding.request.id,
        text: "legacy result",
        final: true,
        visibility: "conversation",
        security: {
          version: binding.security.version,
          projectId: binding.security.projectId,
          revision: binding.security.revision,
          audience: binding.security.audience,
        },
      };
      const raw = JSON.stringify(reply);
      const candidate: ImOutboundCandidate = {
        id,
        threadId,
        kind: "reply",
        contentHash: imContentHash(raw),
        security: {
          ...binding.security,
          ...(state === "stale" ? { revision: "old-revision" } : {}),
        },
        expiresAt: Date.now() + (state === "expired" ? -1000 : 300000),
        state: "pending",
        reason: "legacy full-local review",
      };
      const put = db.prepare(
        "INSERT OR REPLACE INTO im_state(namespace,id,value) VALUES(?,?,?)",
      );
      put.run("outbound-candidates", id, JSON.stringify(candidate));
      put.run(
        "outbound-bodies",
        id,
        JSON.stringify(Buffer.from(raw).toString("base64")),
      );
      await f.service.poll();
      const saved = JSON.parse(
        String(
          db
            .prepare(
              "SELECT value FROM im_state WHERE namespace='outbound-candidates' AND id=?",
            )
            .get(id)!.value,
        ),
      );
      expect(saved.state).toBe(
        state === "current"
          ? "sent"
          : state === "expired"
            ? "expired"
            : "pending",
      );
    } finally {
      db.close();
    }
  },
);
it("rejects in-flight full-local output when the grant changes even if its path remains readable", async () => {
  const f = await fixture();
  const command = authorizationCommand(f);
  command.scope.localAccess = "full";
  command.fullAccessConfirmed = true;
  command.confirmationFingerprint = imAuthorizationFingerprint(command);
  const created = (await f.service.manage({
    action: "authorize-group",
    command,
  })) as ImAuthorizationOperation;
  await f.service.accept(
    f.gateway.router.groupConversationContext(
      command.deviceId,
      created.group!.id,
    ),
  );
  const threadId = f.threads.at(-1)!.id;
  let release!: () => void;
  let started!: () => void;
  const reading = new Promise<void>((resolve) => {
    started = resolve;
  });
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  vi.spyOn(localAccess, "readLocalImFile").mockImplementationOnce(async () => {
    started();
    await pending;
    return {
      output: "old full-access content",
      contentHash: "a".repeat(64),
      exitCode: 0,
      cancelled: false,
    };
  });
  const operation = f.service.operate(
    threadId,
    { action: "read", path: "README.md" },
    "plan",
    "race-read",
  );
  const rejected = expect(operation).rejects.toThrow(/Authorization changed/);
  await reading;
  const settings = f.service.status().settings;
  const grant = settings.grants[0]!;
  const scope = grant.security!.scopes.find(
    (s) => s.audience === `space:${created.group!.id}`,
  )!;
  const edit: ImAuthorizationCommand = {
    ...command,
    operationId: randomUUID(),
    intent: "edit",
    policy: undefined,
    fullAccessConfirmed: undefined,
    scope: { ...scope, localAccess: "project" },
    expectedPolicyVersion: imPolicyVersion(grant),
    expectedGroupVersion: created.group!.revision!,
    expectedScopeVersion: scope.revision!,
    expectedDeviceEnabled: settings.enabled,
    expectedImpactVersion: imAuthorizationImpactVersion(
      settings,
      "p",
      false,
      true,
    ),
  };
  edit.confirmationFingerprint = imAuthorizationFingerprint(edit);
  try {
    expect(
      (
        (await f.service.manage({
          action: "authorize-group",
          command: edit,
        })) as ImAuthorizationOperation
      ).state,
    ).toBe("complete");
  } finally {
    release();
  }
  await rejected;
});
