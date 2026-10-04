// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import "../../fixtures/renderer-test-utils.js";
import {
  booleanUiState,
  usePersistentUiState,
} from "../../../src/renderer/app/ui-state.js";
import { useWorkspaceUiState } from "../../../src/renderer/workspace/workspace-ui-state.js";
import {
  emptyWorkspaceTabs,
  reconcileOfficeWorkspaceTab,
  reduceWorkspaceTabs,
} from "../../../src/renderer/workspace/workspace-tabs.js";
import type { ArtifactSession } from "@artemis/protocol";

beforeEach(() => localStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe("persistent UI choices", () => {
  it.each([
    "artemis-sidebar-open",
    "artemis-projects-open",
    "artemis-office-follow",
  ])(
    "saves %s immediately, synchronizes mounted panels and survives recreation",
    (key) => {
      const first = renderHook(() =>
        usePersistentUiState(key, booleanUiState, true),
      );
      const peer = renderHook(() =>
        usePersistentUiState(key, booleanUiState, true),
      );
      act(() => {
        first.result.current[1](false);
        expect(JSON.parse(localStorage.getItem(key)!)).toEqual({
          protocolVersion: 1,
          value: false,
        });
      });
      expect(peer.result.current[0]).toBe(false);
      first.unmount();
      peer.unmount();
      expect(
        renderHook(() => usePersistentUiState(key, booleanUiState, true)).result
          .current[0],
      ).toBe(false);
    },
  );

  it.each([
    "broken",
    '{"protocolVersion":2,"value":false}',
    '{"protocolVersion":1,"value":"false"}',
  ])("ignores invalid or unsupported preferences: %s", (raw) => {
    localStorage.setItem("choice", raw);
    const { result } = renderHook(() =>
      usePersistentUiState("choice", booleanUiState, true),
    );
    expect(result.current[0]).toBe(true);
    expect(localStorage.getItem("choice")).toBe(raw);
  });

  it("keeps controls usable if storage is unavailable", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    const { result } = renderHook(() =>
      usePersistentUiState("choice", booleanUiState, true),
    );
    act(() => result.current[1](false));
    expect(result.current[0]).toBe(false);
  });
});

const session: ArtifactSession = {
  protocolVersion: 1,
  documentId: "doc",
  sessionId: "office",
  path: "Brief.docx",
  format: "word",
  engineVersion: "test",
  version: 1,
  savedVersion: 1,
  previewVersion: 1,
  sequence: 1,
  status: "saved",
};
const browser = {
  id: "browser",
  kind: "browser" as const,
  title: "Web",
  url: "https://example.com",
};

describe("workspace restart recovery", () => {
  it("keeps a closed Office tab and collapsed dock closed after reloading history", () => {
    const first = renderHook(() => useWorkspaceUiState("one"));
    act(() => {
      first.result.current.setTabsByThread({
        one: reconcileOfficeWorkspaceTab(emptyWorkspaceTabs(), session, true),
      });
      first.result.current.setDockOpen(true);
      first.result.current.setTabsByThread((current) => ({
        ...current,
        one: reduceWorkspaceTabs(current.one!, {
          type: "close",
          tabId: "office:office",
        }),
      }));
    });
    first.unmount();
    const second = renderHook(() => useWorkspaceUiState("one"));
    const restored = second.result.current.tabsByThread.one!;
    expect(restored.tabs).toEqual([]);
    expect(second.result.current.dockOpen).toBe(false);
    expect(reconcileOfficeWorkspaceTab(restored, session)).toBe(restored);
    expect(
      reconcileOfficeWorkspaceTab(
        restored,
        { ...session, sessionId: "new" },
        true,
      ).tabs,
    ).toHaveLength(1);
  });

  it("restores retained tabs and active selection without expanding a collapsed dock", () => {
    const first = renderHook(() => useWorkspaceUiState("one"));
    act(() =>
      first.result.current.setTabsByThread({
        one: {
          ...reconcileOfficeWorkspaceTab(emptyWorkspaceTabs(), session, true),
          dockOpen: false,
        },
      }),
    );
    act(() =>
      first.result.current.setTabsByThread((current) => ({
        ...current,
        one: reduceWorkspaceTabs(current.one!, { type: "open", tab: browser }),
      })),
    );
    first.unmount();
    const second = renderHook(() => useWorkspaceUiState("one"));
    expect(second.result.current.tabsByThread.one).toMatchObject({
      activeTabId: "browser",
      tabs: [expect.objectContaining({ kind: "office" }), browser],
      dockOpen: false,
    });
    expect(second.result.current.dockOpen).toBe(false);
  });

  it("keeps each conversation's dock independent and does not overwrite a rapid close", () => {
    const { result, rerender } = renderHook(
      ({ id }) => useWorkspaceUiState(id),
      { initialProps: { id: "one" } },
    );
    act(() => {
      result.current.setDockOpen(true);
      result.current.setDockOpen(false);
      result.current.setDockOpen(true);
    });
    rerender({ id: "two" });
    expect(result.current.dockOpen).toBe(false);
    act(() => result.current.setDockOpen(false));
    rerender({ id: "one" });
    expect(result.current.dockOpen).toBe(true);
  });
});
