// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  PROTOCOL_VERSION,
  type Automation,
  type AutomationEvent,
  type AutomationRun,
} from "@artemis/protocol";
import { stubWindowArtemis } from "../../fixtures/renderer-test-utils.js";
import { useAutomationCount } from "../../../src/renderer/automation/useAutomationCount.js";

const automation = { id: "automation" } as Automation;
const event = (payload: AutomationEvent["payload"]): AutomationEvent => ({
  protocolVersion: PROTOCOL_VERSION,
  eventId: crypto.randomUUID(),
  timestamp: new Date().toISOString(),
  payload,
});
function setup(listAutomations = vi.fn(async () => [automation])) {
  let listener!: (event: AutomationEvent) => void;
  const unsubscribe = vi.fn();
  stubWindowArtemis({
    listAutomations,
    onAutomationEvent: (callback: typeof listener) => {
      listener = callback;
      return unsubscribe;
    },
  });
  const hook = renderHook(useAutomationCount);
  return {
    ...hook,
    listAutomations,
    unsubscribe,
    emit: (value: AutomationEvent) => act(() => listener(value)),
  };
}

describe("automation navigation count", () => {
  it("loads once, refreshes list changes and ignores run status updates", async () => {
    const view = setup();
    expect(view.result.current).toBeUndefined();
    await waitFor(() => expect(view.result.current).toBe(1));
    view.rerender();
    view.emit(
      event({
        type: "automation-run.upserted",
        run: { id: "run" } as AutomationRun,
      }),
    );
    expect(view.listAutomations).toHaveBeenCalledTimes(1);
    view.listAutomations.mockResolvedValue([]);
    view.emit(
      event({ type: "automation.deleted", automationId: automation.id }),
    );
    await waitFor(() => expect(view.result.current).toBe(0));
    view.listAutomations.mockResolvedValue([
      automation,
      { ...automation, id: "second" },
    ]);
    view.emit(event({ type: "automation.upserted", automation }));
    await waitFor(() => expect(view.result.current).toBe(2));
    expect(view.listAutomations).toHaveBeenCalledTimes(3);
    view.unmount();
    expect(view.unsubscribe).toHaveBeenCalledOnce();
  });

  it("does not let a slow initial request overwrite a newer deletion", async () => {
    let resolveInitial!: (items: Automation[]) => void;
    const initial = new Promise<Automation[]>((resolve) => {
      resolveInitial = resolve;
    });
    const load = vi
      .fn(async () => [] as Automation[])
      .mockReturnValueOnce(initial);
    const view = setup(load);
    view.emit(
      event({ type: "automation.deleted", automationId: automation.id }),
    );
    await waitFor(() => expect(view.result.current).toBe(0));
    await act(async () => resolveInitial([automation]));
    expect(view.result.current).toBe(0);
  });

  it("hides an unavailable count instead of inventing zero", async () => {
    const view = setup();
    await waitFor(() => expect(view.result.current).toBe(1));
    view.listAutomations.mockRejectedValueOnce(new Error("offline"));
    view.emit(event({ type: "automation.upserted", automation }));
    await waitFor(() => expect(view.result.current).toBeUndefined());
  });
});
