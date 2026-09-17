import { describe, expect, it, vi } from "vitest";
import { SleepPrevention } from "../src/main/sleep-prevention.js";

describe("SleepPrevention", () => {
  it("keeps an idle/background app awake without blocking display sleep", () => {
    const blocker = { start: vi.fn(() => 0), stop: vi.fn(() => true) };
    const controller = new SleepPrevention(blocker);
    controller.setEnabled(false);
    expect(blocker.start).not.toHaveBeenCalled();
    controller.setEnabled(true);
    controller.setEnabled(true);
    expect(blocker.start).toHaveBeenCalledExactlyOnceWith(
      "prevent-app-suspension",
    );
    expect(blocker.stop).not.toHaveBeenCalled();
    controller.setEnabled(false);
    controller.setEnabled(false);
    expect(blocker.stop).toHaveBeenCalledExactlyOnceWith(0);
    controller.setEnabled(true);
    expect(blocker.start).toHaveBeenCalledTimes(2);
    controller.dispose();
    controller.dispose();
    expect(blocker.stop).toHaveBeenCalledTimes(2);
  });
});
