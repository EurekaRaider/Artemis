import { describe, expect, it, vi } from "vitest";
import type { Input, WebContents } from "electron";
import { installWorkspaceHistoryShortcuts } from "../../../src/main/workspace/workspace-history-shortcuts.js";

function fixture(handled: boolean) {
  let key!: (event: { preventDefault(): void }, input: Input) => void;
  const contents = {
    on: vi.fn((_event, listener) => {
      key = listener;
    }),
    executeJavaScript: vi.fn().mockResolvedValue(handled),
    undo: vi.fn(),
    redo: vi.fn(),
    isDestroyed: () => false,
  };
  installWorkspaceHistoryShortcuts(contents as unknown as WebContents);
  const press = (properties: Partial<Input> = {}) => {
    const event = { preventDefault: vi.fn() };
    key(event, {
      type: "keyDown",
      key: "z",
      code: "KeyZ",
      meta: true,
      control: false,
      shift: false,
      alt: false,
      isAutoRepeat: false,
      isComposing: false,
      ...properties,
    } as Input);
    return event;
  };
  return { contents, press };
}

describe("native document history shortcuts", () => {
  it("routes Command-Z to the active document instead of the native menu history", async () => {
    const { contents, press } = fixture(true);
    expect(press().preventDefault).toHaveBeenCalledOnce();
    await vi.waitFor(() =>
      expect(contents.executeJavaScript).toHaveBeenCalledWith(
        'window.artemisApplyWorkspaceHistory?.("undo") ?? false',
      ),
    );
    expect(contents.undo).not.toHaveBeenCalled();
  });
  it.each([
    { meta: true, shift: true, key: "Z" },
    { meta: false, control: true, key: "y" },
  ])(
    "routes redo shortcuts and preserves native history outside a document",
    async (keys) => {
      const { contents, press } = fixture(false);
      press(keys);
      await vi.waitFor(() => expect(contents.redo).toHaveBeenCalledOnce());
    },
  );
  it("leaves ordinary input, key-up and IME events alone", () => {
    const { contents, press } = fixture(true);
    for (const keys of [
      { type: "keyUp" as const },
      { isComposing: true },
      { key: "s" },
      { alt: true },
    ])
      expect(press(keys).preventDefault).not.toHaveBeenCalled();
    expect(contents.executeJavaScript).not.toHaveBeenCalled();
  });
});
