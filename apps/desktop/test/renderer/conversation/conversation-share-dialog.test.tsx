// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ConversationShareDialog } from "../../../src/renderer/conversation/ConversationShareDialog.js";
import type { SharePreview } from "../../../src/shared/conversation-share.js";
import "../../fixtures/renderer-test-utils.js";

const preview: SharePreview = {
  id: "preview",
  threadId: "thread",
  title: "Synthetic conversation",
  createdAt: "2026-10-17T00:00:00Z",
  previewUrl: "artemis-preview://share-preview/session.html?revision=1",
  messages: [
    { id: "one", role: "user", text: "Public question", included: true },
    { id: "two", role: "assistant", text: "Public answer", included: true },
  ],
  options: { tools: false, thinking: false, attachments: false },
  destinations: { gist: true, radius: false },
};
const api = {
  prepareConversationShare: vi.fn(),
  updateConversationShare: vi.fn(),
  uploadConversationShare: vi.fn(),
  cancelConversationShare: vi.fn(),
  exportConversationShare: vi.fn(),
  listConversationShares: vi.fn(),
  deleteConversationShare: vi.fn(),
};
beforeEach(() => {
  vi.resetAllMocks();
  api.prepareConversationShare.mockResolvedValue(structuredClone(preview));
  api.listConversationShares.mockResolvedValue([]);
  api.updateConversationShare.mockImplementation(
    async (_id, options, excludedIds) => ({
      ...preview,
      options,
      messages: preview.messages.map((m) => ({
        ...m,
        included: !excludedIds.includes(m.id),
      })),
    }),
  );
  Object.defineProperty(window, "artemis", { value: api, configurable: true });
});
afterEach(cleanup);

it("synchronizes the isolated preview when the desktop theme changes", async () => {
  render(
    <ConversationShareDialog threadId="thread" locale="en" onClose={vi.fn()} />,
  );
  const frame = (await screen.findByTitle(
    "Share preview",
  )) as HTMLIFrameElement;
  const send = vi.spyOn(frame.contentWindow!, "postMessage");
  document.documentElement.dataset.theme = "dark";
  fireEvent.load(frame);
  await waitFor(() =>
    expect(send).toHaveBeenCalledWith(
      { type: "artemis-share-theme", theme: "dark" },
      "*",
    ),
  );
  document.documentElement.dataset.theme = "light";
  await waitFor(() =>
    expect(send).toHaveBeenLastCalledWith(
      { type: "artemis-share-theme", theme: "light" },
      "*",
    ),
  );
});

it("previews an offline sandboxed snapshot without uploading and updates selected messages", async () => {
  render(
    <ConversationShareDialog threadId="thread" locale="en" onClose={vi.fn()} />,
  );
  await screen.findByText("Synthetic conversation");
  expect(api.uploadConversationShare).not.toHaveBeenCalled();
  expect(screen.getByTitle("Share preview").getAttribute("sandbox")).toBe(
    "allow-scripts",
  );
  fireEvent.click(screen.getByLabelText("Include thinking"));
  await waitFor(() =>
    expect(api.updateConversationShare).toHaveBeenCalledWith(
      "preview",
      { ...preview.options, thinking: true },
      [],
    ),
  );
  await waitFor(() =>
    expect(screen.getByLabelText("Include thinking")).toBeChecked(),
  );
  fireEvent.click(screen.getByLabelText("Include user: Public question"));
  await waitFor(() =>
    expect(api.updateConversationShare).toHaveBeenLastCalledWith(
      "preview",
      { ...preview.options, thinking: true },
      ["one"],
    ),
  );
});

it("uploads only after a click and shows a receipt with a confirmed deletion action", async () => {
  api.uploadConversationShare.mockResolvedValue({
    id: "receipt",
    threadId: "thread",
    title: preview.title,
    destination: "gist",
    remoteId: "abc123",
    createdAt: preview.createdAt,
    url: "https://pi.dev/session/#abc123",
  });
  render(
    <ConversationShareDialog threadId="thread" locale="en" onClose={vi.fn()} />,
  );
  const upload = await screen.findByRole("button", { name: "Upload snapshot" });
  fireEvent.click(upload);
  await screen.findByRole("button", { name: "Copy link" });
  expect(api.uploadConversationShare).toHaveBeenCalledOnce();
  expect(api.uploadConversationShare).toHaveBeenCalledWith("preview", "auto");
  fireEvent.click(screen.getByRole("button", { name: "Delete share" }));
  expect(api.deleteConversationShare).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Confirm deletion" }));
  await waitFor(() =>
    expect(api.deleteConversationShare).toHaveBeenCalledWith("receipt"),
  );
  expect(screen.queryByRole("button", { name: "Copy link" })).toBeNull();
});

it("offers HTML export without cloud authentication and reports an upload error without retries", async () => {
  api.prepareConversationShare.mockResolvedValue({
    ...preview,
    destinations: { gist: false, radius: false },
  });
  api.exportConversationShare.mockResolvedValue(true);
  render(
    <ConversationShareDialog threadId="thread" locale="en" onClose={vi.fn()} />,
  );
  await screen.findByText("Synthetic conversation");
  expect(
    screen.getByRole("button", { name: "Upload snapshot" }),
  ).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Export HTML" }));
  await screen.findByRole("status");
  await waitFor(() =>
    expect(api.exportConversationShare).toHaveBeenCalledWith("preview"),
  );
  expect(api.uploadConversationShare).not.toHaveBeenCalled();
});

it("keeps a failed upload visible and requires a new reviewed snapshot before another attempt", async () => {
  api.uploadConversationShare.mockRejectedValue(
    new Error("Synthetic network failure"),
  );
  render(
    <ConversationShareDialog threadId="thread" locale="en" onClose={vi.fn()} />,
  );
  fireEvent.click(
    await screen.findByRole("button", { name: "Upload snapshot" }),
  );
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Synthetic network failure",
  );
  expect(api.uploadConversationShare).toHaveBeenCalledOnce();
  expect(screen.queryByRole("button", { name: "Upload snapshot" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Prepare new snapshot" }));
  await screen.findByRole("button", { name: "Upload snapshot" });
  expect(api.prepareConversationShare).toHaveBeenCalledTimes(2);
});
