// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { useSidebarNavigation } from "../../../src/renderer/app/use-sidebar-navigation.js";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  localStorage.clear();
});

it("retains a collapsed sidebar across mounts and cancels pending hover on leave", () => {
  vi.useFakeTimers();
  const mount = () =>
    renderHook(() => useSidebarNavigation(useRef<HTMLElement>(null)));
  const first = mount();
  act(() => first.result.current.changeSidebarOpen(false));
  first.unmount();
  const next = mount();
  expect(next.result.current.sidebarOpen).toBe(false);
  act(() => next.result.current.requestSidebarPeek());
  act(() => vi.advanceTimersByTime(199));
  expect(next.result.current.sidebarPeek).toBe(false);
  act(() => next.result.current.closeSidebarPeek());
  act(() => vi.advanceTimersByTime(201));
  expect(next.result.current.sidebarPeek).toBe(false);
  act(() => next.result.current.requestSidebarPeek());
  act(() => vi.advanceTimersByTime(200));
  expect(next.result.current.sidebarPeek).toBe(true);
  act(() => next.result.current.changeSidebarOpen(true));
  expect(next.result.current.sidebarOpen).toBe(true);
  expect(next.result.current.sidebarPeek).toBe(false);
});
