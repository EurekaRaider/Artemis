import { mkdir } from "node:fs/promises";

import { join } from "node:path";
import { randomUUID } from "node:crypto";

import { expect, it, vi } from "vitest";
import {
  imAuthorizationFingerprint,
  imPolicyVersion,
  imAuthorizationImpactVersion,
  type ImAuthorizationCommand,
  type ImAuthorizationOperation,
  type CollaborationSpace,
} from "@artemis/protocol";

import { ImService } from "../../../../src/main/im/im-service.js";
import {
  cleanup,
  fixture,
  authorizationCommand,
} from "../../../fixtures/im/native-groups.js";
it("commits and replays narrow authorization without rolling versions or expiration", async () => {
  const f = await fixture();
  const command = authorizationCommand(f);
  const first = (await f.service.manage({
    action: "authorize-group",
    command,
  })) as ImAuthorizationOperation;
  expect(first).toMatchObject({
    state: "complete",
    phases: { local: "applied", activation: "applied", sync: "applied" },
  });
  const before = f.service.status().settings;
  expect(
    await f.service.manage({ action: "authorize-group", command }),
  ).toEqual(first);
  expect(f.service.status().settings).toEqual(before);
  expect(f.gateway.store.list("native-groups")).toHaveLength(1);
  const changed = { ...command, name: "Changed" };
  changed.confirmationFingerprint = imAuthorizationFingerprint(changed);
  await expect(
    f.service.manage({ action: "authorize-group", command: changed }),
  ).rejects.toThrow(/ID conflicts/);
});
it("rejects stale policy and empty selected scope before persisting an operation", async () => {
  const f = await fixture();
  const command = authorizationCommand(f);
  command.scope.readMode = "selected";
  command.confirmationFingerprint = imAuthorizationFingerprint(command);
  await expect(
    f.service.manage({ action: "authorize-group", command }),
  ).rejects.toThrow();
  expect(f.service.status().authorizationOperations).toEqual([]);
  expect(f.gateway.store.list("native-groups")).toEqual([]);
  command.scope.readMode = "project";
  command.expectedPolicyVersion = "stale";
  command.confirmationFingerprint = imAuthorizationFingerprint(command);
  await expect(
    f.service.manage({ action: "authorize-group", command }),
  ).rejects.toThrow(/version conflict/);
  expect(f.service.status().authorizationOperations).toEqual([]);
});
it.each(["prepare", "activate"])(
  "reconciles a lost %s response using the Gateway journal",
  async (phase) => {
    const f = await fixture();
    const command = authorizationCommand(f);
    const original = globalThis.fetch;
    let lost = false;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url, options) => {
      const response = await original(url, options);
      if (
        !lost &&
        String(url).endsWith("/native-authorization") &&
        JSON.parse(String(options?.body)).phase === phase
      ) {
        lost = true;
        throw new Error("Injected response loss");
      }
      return response;
    });
    const failed = (await f.service.manage({
      action: "authorize-group",
      command,
    })) as ImAuthorizationOperation;
    expect(failed.state).toBe("pending");
    expect(Object.values(failed.phases)).toContain("unknown");
    const group = f.gateway.store.list<{ revision: string }>(
      "native-groups",
    )[0]!;
    const resumed = (await f.service.manage({
      action: "retry-group-authorization",
      operationId: command.operationId,
    })) as ImAuthorizationOperation;
    expect(resumed.state).toBe("complete");
    expect(resumed.group?.revision).toBe(group.revision);
    expect(f.gateway.store.list("native-groups")).toHaveLength(1);
  },
);
it("serializes double clicks and changes only the target scope without rebinding", async () => {
  const f = await fixture();
  const command = authorizationCommand(f);
  const [a, b] = (await Promise.all(
    [1, 2].map(() => f.service.manage({ action: "authorize-group", command })),
  )) as ImAuthorizationOperation[];
  expect(a).toEqual(b);
  const grant = f.service.status().settings.grants[0]!;
  const scope = grant.security!.scopes[0]!;
  const edit = {
    ...command,
    operationId: randomUUID(),
    intent: "edit" as const,
    expectedGroupVersion: a!.group!.revision!,
    expectedScopeVersion: scope.revision!,
    expectedPolicyVersion: imPolicyVersion(grant),
    scope: {
      ...scope,
      readMode: "selected" as const,
      readPaths: ["future.txt"],
    },
  };
  delete (edit as Partial<ImAuthorizationCommand>).policy;
  edit.confirmationFingerprint = imAuthorizationFingerprint(edit);
  const changed = (await f.service.manage({
    action: "authorize-group",
    command: edit,
  })) as ImAuthorizationOperation;
  expect(changed).toMatchObject({
    state: "complete",
    phases: { binding: "not-needed", activation: "not-needed" },
  });
  expect(changed.group?.revision).toBe(a!.group!.revision);
  expect(f.service.status().settings.grants[0]!.expiresAt).toBe(
    grant.expiresAt,
  );
});
it("recovers a committed operation after restart without repeating the local write", async () => {
  const f = await fixture();
  const command = authorizationCommand(f);
  const original = globalThis.fetch;
  let fail = true;
  vi.spyOn(globalThis, "fetch").mockImplementation(async (url, options) => {
    if (
      fail &&
      String(url).endsWith("/native-authorization") &&
      JSON.parse(String(options?.body)).phase === "activate"
    )
      throw new Error("Injected activation outage");
    return original(url, options);
  });
  const pending = (await f.service.manage({
    action: "authorize-group",
    command,
  })) as ImAuthorizationOperation;
  expect(pending.phases.local).toBe("applied");
  expect(f.starts).toEqual([]);
  const grant = f.service.status().settings.grants[0]!;
  await f.service.close();
  fail = false;
  const restarted = new ImService(
    f.root,
    {
      isEncryptionAvailable: () => true,
      encryptString: (s) => Buffer.from(s),
      decryptString: (b) => b.toString(),
    },
    f.ops,
  );
  cleanup.push(() => restarted.close());
  restarted.start();
  await vi.waitFor(() =>
    expect(restarted.status().authorizationOperations?.[0]?.state).toBe(
      "complete",
    ),
  );
  expect(restarted.status().settings.grants[0]).toEqual(grant);
});
it("keeps a prepared group disabled when its owner is revoked before recovery", async () => {
  const f = await fixture();
  const command = authorizationCommand(f);
  const original = globalThis.fetch;
  let lost = false;
  vi.spyOn(globalThis, "fetch").mockImplementation(async (url, options) => {
    const response = await original(url, options);
    if (!lost && String(url).endsWith("/native-authorization")) {
      lost = true;
      throw new Error("lost");
    }
    return response;
  });
  await f.service.manage({ action: "authorize-group", command });
  f.gateway.store.delete(
    "identities",
    JSON.stringify([
      command.owner.channel,
      command.owner.connectionId,
      command.owner.tenantId,
      command.owner.appId,
      command.owner.userId,
    ]),
  );
  const resumed = (await f.service.manage({
    action: "retry-group-authorization",
    operationId: command.operationId,
  })) as ImAuthorizationOperation;
  expect(resumed.state).toBe("conflict");
  expect(f.gateway.router.findSpace(f.event.conversation)).toBeUndefined();
  expect(f.service.status().settings.grants).toEqual([]);
});
it("rebinds to a new project without reusing old model context or old effective scopes", async () => {
  const f = await fixture();
  await f.authorize();
  const oldThread = f.service.status().remoteTasks![0]!.threadId;
  const group =
    f.gateway.store.list<import("@artemis/protocol").CollaborationSpace>(
      "native-groups",
    )[0]!;
  const projects = f.ops.projects();
  const nextPath = join(f.root, "next-project");
  await mkdir(nextPath);
  f.ops.projects = () => [
    ...projects,
    { ...projects[0]!, id: "next", name: "Next", path: nextPath },
  ];
  const command = authorizationCommand(f);
  Object.assign(command, {
    intent: "rebind",
    projectId: "next",
    expectedGroupVersion: group.revision,
    expectedImpactVersion: imAuthorizationImpactVersion(
      f.service.status().settings,
      "next",
      true,
      true,
    ),
  });
  command.confirmationFingerprint = imAuthorizationFingerprint(command);
  const result = (await f.service.manage({
    action: "authorize-group",
    command,
  })) as ImAuthorizationOperation;
  expect(result.state).toBe("complete");
  const oldGrant = f.service
    .status()
    .settings.grants.find((g) => g.projectId === "p")!;
  expect(oldGrant.groups).not.toContain(`space:${group.id}`);
  expect(
    oldGrant.security?.scopes.some((s) => s.audience === `space:${group.id}`),
  ).toBe(false);
  const newThread = f.service
    .status()
    .remoteTasks!.find(
      (t) => t.group?.spaceId === group.id && t.threadId !== oldThread,
    );
  expect(newThread).toBeDefined();
  expect(newThread?.currentGroupEntry).toBe(true);
  expect(
    f.service.status().remoteTasks!.find((t) => t.threadId === oldThread)
      ?.currentGroupEntry,
  ).toBe(false);
  expect(f.threads.some((t) => t.id === oldThread)).toBe(true);
  await expect(
    f.service.manage({
      action: "native-group-input",
      threadId: oldThread,
      messageId: randomUUID(),
      destination: "local",
      text: "Use old context",
    }),
  ).rejects.toThrow();
});
it("allows a newly confirmed CAS operation to replace an incomplete activation without rollback", async () => {
  const f = await fixture();
  const command = authorizationCommand(f);
  const original = globalThis.fetch;
  let fail = true;
  vi.spyOn(globalThis, "fetch").mockImplementation(async (url, options) => {
    if (
      fail &&
      String(url).endsWith("/native-authorization") &&
      JSON.parse(String(options?.body)).phase === "activate"
    )
      throw new Error("activation unavailable");
    return original(url, options);
  });
  const pending = (await f.service.manage({
    action: "authorize-group",
    command,
  })) as ImAuthorizationOperation;
  expect(pending.phases.local).toBe("applied");
  const grant = f.service.status().settings.grants[0]!;
  const replacement = {
    ...command,
    operationId: randomUUID(),
    supersedes: command.operationId,
    intent: "restore" as const,
    expectedGroupVersion: pending.group!.revision!,
    expectedPolicyVersion: imPolicyVersion(grant),
    expectedScopeVersion: grant.security!.scopes[0]!.revision!,
    expectedDeviceEnabled: true,
    expectedImpactVersion: imAuthorizationImpactVersion(
      f.service.status().settings,
      "p",
      true,
      true,
    ),
  };
  replacement.confirmationFingerprint = imAuthorizationFingerprint(replacement);
  fail = false;
  const result = (await f.service.manage({
    action: "authorize-group",
    command: replacement,
  })) as ImAuthorizationOperation;
  expect(result.error).toBeUndefined();
  expect(result.state).toBe("complete");
  expect(
    f.service
      .status()
      .authorizationOperations?.find(
        (op) => op.command.operationId === command.operationId,
      )?.state,
  ).toBe("superseded");
  expect(f.service.status().settings.grants[0]!.expiresAt).toBe(
    grant.expiresAt,
  );
  expect(
    (
      (await f.service.manage({
        action: "authorize-group",
        command,
      })) as ImAuthorizationOperation
    ).state,
  ).toBe("superseded");
});
it.each(["journal", "local"])(
  "recovers a %s persistence failure without early execution",
  async (boundary) => {
    const f = await fixture();
    const command = authorizationCommand(f);
    const internal = f.service as unknown as {
      put(namespace: string, id: string, value: unknown): void;
    };
    const original = internal.put.bind(internal);
    let failed = false;
    vi.spyOn(internal, "put").mockImplementation((namespace, id, value) => {
      if (
        !failed &&
        (boundary === "journal"
          ? namespace === "group-authorizations"
          : namespace === "settings" &&
            f.service
              .status()
              .authorizationOperations?.some(
                (op) => op.phases.binding === "applied",
              ))
      ) {
        failed = true;
        throw new Error("Injected persistence failure");
      }
      original(namespace, id, value);
    });
    if (boundary === "journal") {
      await expect(
        f.service.manage({ action: "authorize-group", command }),
      ).rejects.toThrow(/persistence/);
      expect(f.gateway.store.list("native-groups")).toHaveLength(0);
      expect(f.service.status().authorizationOperations).toEqual([]);
    } else {
      const pending = (await f.service.manage({
        action: "authorize-group",
        command,
      })) as ImAuthorizationOperation;
      expect(pending.phases.local).toBe("failed");
      expect(f.gateway.router.findSpace(command.conversation)).toBeUndefined();
    }
    expect(f.service.status().settings.grants).toEqual([]);
    expect(f.starts).toEqual([]);
    const result = (await f.service.manage({
      action: "authorize-group",
      command,
    })) as ImAuthorizationOperation;
    expect(result.error).toBeUndefined();
    expect(result.state).toBe("complete");
  },
);
it("retries post-commit task effects without re-saving the local authorization", async () => {
  const f = await fixture();
  const first = authorizationCommand(f);
  const saved = (await f.service.manage({
    action: "authorize-group",
    command: first,
  })) as ImAuthorizationOperation;
  const grant = f.service.status().settings.grants[0]!;
  const command = {
    ...first,
    operationId: randomUUID(),
    intent: "edit" as const,
    expectedImpactVersion: imAuthorizationImpactVersion(
      f.service.status().settings,
      "p",
      true,
      true,
    ),
    expectedGroupVersion: saved.group!.revision!,
    expectedPolicyVersion: imPolicyVersion(grant),
    expectedScopeVersion: grant.security!.scopes[0]!.revision!,
    scope: {
      ...first.scope,
      readMode: "selected" as const,
      readPaths: ["future.txt"],
    },
  };
  command.confirmationFingerprint = imAuthorizationFingerprint(command);
  f.ops.close = vi
    .fn()
    .mockRejectedValueOnce(new Error("Injected close failure"))
    .mockResolvedValue(undefined);
  const pending = (await f.service.manage({
    action: "authorize-group",
    command,
  })) as ImAuthorizationOperation;
  expect(pending.phases.local).toBe("applied");
  expect(pending.state).toBe("pending");
  const before = f.service.status().settings;
  const resumed = (await f.service.manage({
    action: "retry-group-authorization",
    operationId: command.operationId,
  })) as ImAuthorizationOperation;
  expect(resumed.error).toBeUndefined();
  expect(resumed.state).toBe("complete");
  expect(f.service.status().settings).toEqual(before);
  expect(f.ops.close).toHaveBeenCalledTimes(2);
});
it("queues device registration behind an in-flight group authorization", async () => {
  const f = await fixture();
  await f.service.save({ ...f.service.status().settings, enabled: false });
  const command = authorizationCommand(f);
  let release!: () => void;
  let reached!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const entered = new Promise<void>((resolve) => {
    reached = resolve;
  });
  const original = globalThis.fetch;
  const requests: string[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (url, options) => {
    requests.push(String(url));
    const response = await original(url, options);
    if (
      String(url).endsWith("/native-authorization") &&
      JSON.parse(String(options?.body)).phase === "prepare"
    ) {
      reached();
      await held;
    }
    return response;
  });
  const authorizing = f.service.manage({ action: "authorize-group", command });
  await entered;
  const registering = f.service
    .manage({
      action: "register",
      gatewayUrl: command.gatewayUrl,
      adminToken: "synthetic-invalid-token-".repeat(2),
      name: "Replacement device",
    })
    .catch((error) => error);
  await new Promise((resolve) => setImmediate(resolve));
  const racedRegistration = requests.some((url) =>
    url.endsWith("/admin/register"),
  );
  release();
  const result = (await authorizing) as ImAuthorizationOperation;
  const registration = await registering;
  expect(racedRegistration).toBe(false);
  expect(result.state).toBe("complete");
  expect(String(registration)).toContain("Pause IM");
  expect(f.service.status().settings.deviceId).toBe(command.deviceId);
});
it.each(["feishu", "slack"] as const)(
  "explains %s manual cooperation without changing Slack's error",
  async (channel) => {
    const f = await fixture(channel);
    f.grant.mode = "work";
    await f.authorize();
    const task = f.service.status().remoteTasks![0]!;
    const request = f.gateway.router.groupConversationContext(
      f.service.status().settings.deviceId,
      task.group!.spaceId,
    );
    await f.service.accept({ ...request, text: "Ask peer to check project" });
    const threadId = f.starts.at(-1)!;
    await expect(
      f.service.operate(
        threadId,
        {
          action: "collaborate",
          command: {
            action: "delegate",
            participantId: "peer",
            text: "Check project",
          },
        },
        "work",
        randomUUID(),
      ),
    ).rejects.toThrow(
      channel === "feishu"
        ? "尚未授权群内机器人协作"
        : "自动协作尚未通过 IM 验证",
    );
  },
);
it("reports current local activity consistently in group and settings snapshots", async () => {
  const f = await fixture();
  await f.authorize();
  const groupId = f.service.status().remoteTasks![0]!.group!.spaceId;
  f.gateway.store.put("native-group-info", groupId, {
    roster: {
      complete: true,
      members: [
        {
          identity: { ...f.event.identity, userId: "self" },
          name: "Artemis",
          kind: "bot",
          self: true,
        },
      ],
    },
  });
  await f.service.manage({ action: "refresh" });
  await f.service.poll();
  // This fixture has no real IM adapter; provide its connected status only.
  (f.service as unknown as { channelStatus: unknown[] }).channelStatus = [
    { id: "bot", state: "connected" },
  ];
  const assertState = (state: string) => {
    const status = f.service.status();
    const settings = status.spaces as Array<{
      roster: { members: Array<{ botPresence: { state: string } }> };
    }>;
    expect(settings[0]!.roster.members[0]!.botPresence.state).toBe(state);
    expect(
      status.remoteTasks![0]!.group!.roster!.members[0]!.botPresence!.state,
    ).toBe(state);
  };
  assertState("online");
  f.threads[0]!.status = "running";
  assertState("busy");
  f.threads.push({ ...f.threads[0]!, id: "second" });
  f.threads[0]!.status = "idle";
  assertState("busy");
  f.threads[1]!.status = "waiting-approval";
  assertState("waiting-approval");
  f.threads[1]!.status = "idle";
  assertState("online");
});
