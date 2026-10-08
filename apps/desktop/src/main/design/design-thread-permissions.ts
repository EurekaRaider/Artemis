import { join } from "node:path";
import type { Thread } from "@artemis/protocol";
import type { AppStore } from "../settings/store.js";
import { PluginRevisionStore } from "./design-plugin-revision-store.js";

/** This entry is called by the main-frame UI IPC, never by a tool or panel. */
export async function changeDesignThreadPermissions(input: {
  threadId: string;
  permission: "standard" | "restricted";
  store: AppStore;
  revisionsRoot: string;
  busy(): boolean;
  unavailable(): Promise<string | null>;
  closeSession(): Promise<void>;
}): Promise<Thread> {
  const { store, threadId, permission } = input;
  if (!["standard", "restricted"].includes(permission))
    throw new Error("Invalid design thread permission choice.");
  const original = store.getThread(threadId);
  const binding = original?.typeBinding;
  if (!original || original.archived || !binding || !original.projectId)
    throw new Error("Open a bound project design chat first.");
  const assertCurrent = () => {
    const current = store.getThread(threadId);
    if (
      input.busy() ||
      !current ||
      current.archived ||
      current.typeBinding?.installationId !== binding.installationId ||
      current.typeBinding?.pluginId !== binding.pluginId ||
      current.typeBinding?.contentHash !== binding.contentHash ||
      current.typeBinding?.bindingRevision !== binding.bindingRevision
    )
      throw new Error(
        "Stop the task and pending requests before changing design permissions.",
      );
    const trusted = store
      .listPluginGrants(threadId)
      .some(
        (grant) =>
          grant.installation_id === binding.installationId &&
          grant.plugin_id === binding.pluginId &&
          grant.content_hash === binding.contentHash &&
          grant.grant_revision === binding.bindingRevision &&
          grant.revoked_at == null,
      );
    if (!trusted)
      throw new Error("The design plugin is not trusted for this chat.");
  };
  assertCurrent();
  const unavailable = await input.unavailable();
  if (unavailable) throw new Error(unavailable);
  const actual = await PluginRevisionStore.computeContentHash(
    join(input.revisionsRoot, binding.installationId, binding.contentHash),
  );
  if (actual !== binding.contentHash)
    throw new Error(
      "The design plugin revision changed; reinstall it before changing permissions.",
    );
  assertCurrent();
  // Closing first rejects stale agent requests; no previous operation is replayed.
  await input.closeSession();
  assertCurrent();
  return store.setDesignThreadPermissions(threadId, permission);
}
