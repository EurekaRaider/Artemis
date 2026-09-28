// @vitest-environment jsdom
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  restoreArtifactSnapshot,
  type ArtifactSnapshot,
} from "@artemis/protocol";
import { stubWindowArtemis as stubApi } from "./renderer-test-utils.js";
import { OfficeFilePanel } from "../src/renderer/OfficeFilePanel.js";
const stubWindowArtemis = (api: Parameters<typeof stubApi>[0]) =>
  stubApi({
    officeCapabilityStatus: async () => ({
      phase: "idle",
      versions: [],
      activeVersion: "1.0.0",
    }),
    ...api,
  });

vi.mock("../src/renderer/OfficeWorkbenchPanel.js", () => ({
  OfficeWorkbenchPanel: ({ view }: { view: { session: { path: string } } }) => (
    <div>Rendered {view.session.path}</div>
  ),
}));
const snapshot: ArtifactSnapshot = {
  session: {
    protocolVersion: 1,
    documentId: "doc",
    sessionId: "session",
    path: "Brief.docx",
    format: "word",
    engineVersion: "test",
    version: 0,
    savedVersion: 0,
    previewVersion: null,
    sequence: 1,
    status: "saved",
  },
  sheets: [],
  targets: [],
  warnings: [],
};
const props = {
  threadId: "thread",
  path: "Brief.docx",
  locale: "en" as const,
  onAnnotate: vi.fn(),
  retryLabel: "Retry",
};
describe("Office file opening", () => {
  it("opens the requested workbook instead of rendering a stale Word session", async () => {
    const workbook: ArtifactSnapshot = {
      ...snapshot,
      session: {
        ...snapshot.session,
        path: "Budget.xlsx",
        format: "excel",
        sessionId: "excel-session",
      },
    };
    const open = vi.fn().mockResolvedValue(workbook);
    const opened = vi.fn();
    stubWindowArtemis({ openOfficeFile: open });
    render(
      <OfficeFilePanel
        {...props}
        path="Budget.xlsx"
        view={restoreArtifactSnapshot(undefined, snapshot)}
        onOpened={opened}
      />,
    );
    expect(screen.queryByText("Rendered Brief.docx")).not.toBeInTheDocument();
    expect(await screen.findByText("Rendered Budget.xlsx")).toBeInTheDocument();
    expect(open).toHaveBeenCalledWith("thread", "Budget.xlsx");
    expect(opened).toHaveBeenCalledWith("excel-session");
  });

  it("renders the returned session without requiring a new opened event", async () => {
    const open = vi.fn().mockResolvedValue(snapshot);
    const opened = vi.fn();
    stubWindowArtemis({ openOfficeFile: open });
    render(<OfficeFilePanel {...props} onOpened={opened} />);
    expect(await screen.findByText("Rendered Brief.docx")).toBeInTheDocument();
    expect(open).toHaveBeenCalledWith("thread", "Brief.docx");
    expect(opened).toHaveBeenCalledWith("session");
  });
  it("uses a history session without starting a new engine", async () => {
    const open = vi.fn();
    stubWindowArtemis({ openOfficeFile: open });
    render(
      <OfficeFilePanel
        {...props}
        view={restoreArtifactSnapshot(undefined, snapshot)}
      />,
    );
    expect(await screen.findByText("Rendered Brief.docx")).toBeInTheDocument();
    expect(open).not.toHaveBeenCalled();
  });
  it("shows opening failures and permits retry", async () => {
    const open = vi
      .fn()
      .mockRejectedValueOnce(new Error("Office component unavailable"))
      .mockResolvedValue(snapshot);
    stubWindowArtemis({ openOfficeFile: open });
    render(<OfficeFilePanel {...props} />);
    expect(
      await screen.findByText("Office component unavailable"),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("Rendered Brief.docx")).toBeInTheDocument();
  });
  it("ignores a response belonging to a previous file", async () => {
    let resolve!: (value: ArtifactSnapshot) => void;
    const open = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<ArtifactSnapshot>((done) => {
            resolve = done;
          }),
      )
      .mockResolvedValue({
        ...snapshot,
        session: { ...snapshot.session, path: "Next.docx", sessionId: "next" },
      });
    stubWindowArtemis({ openOfficeFile: open });
    const { rerender } = render(<OfficeFilePanel {...props} />);
    await waitFor(() => expect(open).toHaveBeenCalledOnce());
    rerender(<OfficeFilePanel {...props} path="Next.docx" />);
    expect(await screen.findByText("Rendered Next.docx")).toBeInTheDocument();
    await act(async () => resolve(snapshot));
    expect(screen.queryByText("Rendered Brief.docx")).not.toBeInTheDocument();
  });
});
