export function hasDesignDraft(threadId?: string): boolean {
  const prefix = threadId
    ? `artemis:design-draft:${threadId}:`
    : "artemis:design-draft:";
  return Object.keys(localStorage).some(
    (key) => key.startsWith(prefix) && localStorage.getItem(key) !== "[]",
  );
}
export async function confirmDesignLeave(threadId?: string): Promise<boolean> {
  if (!window.artemis.confirmDesignLeave) return true;
  const allowed = await window.artemis.confirmDesignLeave(threadId);
  if (allowed) {
    const prefix = threadId
      ? `artemis:design-draft:${threadId}:`
      : "artemis:design-draft:";
    for (const key of Object.keys(localStorage))
      if (key.startsWith(prefix)) localStorage.removeItem(key);
    window.dispatchEvent(
      new CustomEvent("artemis-design-drafts-cleared", { detail: threadId }),
    );
  }
  return allowed;
}
