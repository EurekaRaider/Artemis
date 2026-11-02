import { describe, expect, it, vi } from "vitest";
import {
  parseThreadLink,
  dispatchThreadLink,
} from "../../../src/main/conversation/thread-links.js";

const id = "e59ea82c-775a-4a3f-87ab-62c11ac31f3b";
const link = `artemis://thread/${id}`;
describe("external task links", () => {
  it("accepts exactly the local thread route", () => {
    expect(parseThreadLink(link)).toBe(id);
  });
  it.each([
    `https://thread/${id}`,
    `artemis://other/${id}`,
    `artemis://thread/${id}/extra`,
    `${link}?run=true`,
    `${link}#send`,
    `${link}?`,
    `${link}#`,
    `${link}/`,
    "artemis://thread/" + "a".repeat(4096),
    "artemis://thread/../" + id,
    "artemis://thread/%2e%2e/" + id,
    "artemis://user@thread/" + id,
    "artemis://thread:80/" + id,
    "artemis://thread/" + id.replace("-", "%2d"),
    "artemis://thread/not-a-thread",
    "artemis://thread/" + id + "\n",
    null,
  ])("rejects invalid input %s", (url) => {
    expect(parseThreadLink(url)).toBeUndefined();
  });
  it("opens existing and archived records through the same read-only notification", () => {
    for (const archived of [false, true]) {
      const lookup = vi.fn(() => ({ id, archived }));
      const open = vi.fn();
      const missing = vi.fn();
      const forbidden = vi.fn();
      const target = {
        lookup,
        open,
        missing,
        create: forbidden,
        run: forbidden,
        send: forbidden,
        update: forbidden,
      };
      dispatchThreadLink(link, target);
      expect(lookup).toHaveBeenCalledExactlyOnceWith(id);
      expect(open).toHaveBeenCalledExactlyOnceWith(id);
      expect(missing).not.toHaveBeenCalled();
      expect(forbidden).not.toHaveBeenCalled();
    }
  });
  it("reports a missing task without creating or opening one", () => {
    const lookup = vi.fn(() => undefined),
      open = vi.fn(),
      missing = vi.fn();
    dispatchThreadLink(link, { lookup, open, missing });
    expect(open).not.toHaveBeenCalled();
    expect(missing).toHaveBeenCalledOnce();
  });
  it("ignores malformed input before any lookup or action", () => {
    const lookup = vi.fn(),
      open = vi.fn(),
      missing = vi.fn();
    dispatchThreadLink(`${link}?run=true`, { lookup, open, missing });
    expect(lookup).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
    expect(missing).not.toHaveBeenCalled();
  });
});
