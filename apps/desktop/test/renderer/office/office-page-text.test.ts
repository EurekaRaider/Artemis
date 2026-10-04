// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  pageTextAnchors,
  pageTextHitBounds,
  type PageTextRun,
} from "../../../src/renderer/office/office-page-text.js";
const run = (text: string, left = 20): PageTextRun => ({
  text,
  left,
  top: 30,
  width: 40,
  height: 12,
  font: "serif",
});
const paragraph = (text: string, index = 0) => ({
  text,
  selection: { kind: "paragraph" as const, index, start: 0, end: text.length },
});
describe("native text anchors on the document page", () => {
  it("locates repeated table quantities using their own row context", () => {
    const rows = [
      ["显示器支架", "2", "129.50", "259.00", "已验收"],
      ["无线键盘", "2", "189.00", "378.00", "已验收"],
      ["移动硬盘", "1", "499.00", "499.00", "已验收"],
      ["摄像头", "1", "329.00", "329.00", "待验收"],
    ];
    const targets = rows.flat().map(paragraph);
    const runs = rows.flatMap((row, i) =>
      row.map((text, column) => ({ ...run(text, column * 100), top: i * 30 })),
    );
    const anchors = pageTextAnchors(runs, targets, 1, 1);
    expect(anchors).toHaveLength(targets.length);
    for (const [index, target] of targets.entries()) {
      const anchor = anchors.find((anchor) => anchor.target === target)!;
      expect(anchor.left).toBe((index % 5) * 100);
      expect(anchor.top).toBeCloseTo(Math.floor(index / 5) * 30 - 1.2);
    }
  });

  it("uses row context on later pages and rejects identical contexts", () => {
    const values = ["支架", "2", "129.50", "键盘", "2", "189.00"];
    const targets = values.map(paragraph);
    expect(
      pageTextAnchors(
        values.slice(3).map((text, i) => run(text, i * 100)),
        targets,
        2,
        1,
      ).map((anchor) => anchor.target.selection),
    ).toEqual(targets.slice(3).map((target) => target.selection));
    const repeated = ["数量", "2", "合计", "数量", "2", "合计"];
    expect(
      pageTextAnchors(
        repeated.slice(0, 3).map((text, i) => run(text, i * 100)),
        repeated.map(paragraph),
        1,
        1,
      ),
    ).toEqual([]);
  });

  it("makes short numbers easier to click without covering an adjacent row", () => {
    const anchors = pageTextAnchors(
      [
        { ...run("2", 100), width: 6 },
        { ...run("3", 100), width: 6, top: 50 },
      ],
      [paragraph("2"), paragraph("3", 1)],
      1,
      1,
    );
    const first = pageTextHitBounds(anchors[0]!, anchors);
    const next = pageTextHitBounds(anchors[1]!, anchors);
    expect(first.left).toBeLessThan(anchors[0]!.left);
    expect(first.width).toBeGreaterThanOrEqual(28);
    expect(first.top).toBeLessThan(anchors[0]!.top);
    expect(first.top + first.height).toBeLessThanOrEqual(next.top);
  });

  it("anchors outlined slide text to its native object without guessing a paragraph", () => {
    const target = {
      text: "WordArt",
      editable: true,
      selection: { kind: "object" as const, page: 1, index: 0 },
      bounds: { x: 2540, y: 2540, width: 5080, height: 2540 },
    };
    expect(pageTextAnchors([], [target], 1, 1)[0]).toMatchObject({
      left: 72,
      top: 72,
      width: 144,
      height: 72,
      target,
    });
  });
  it("maps a paragraph across PDF font runs without including a header", () => {
    const anchors = pageTextAnchors(
      [run("Header"), run("Hello "), run("world", 60)],
      [paragraph("Hello world")],
      1,
      1,
    );
    expect(anchors).toHaveLength(1);
    expect(anchors[0]).toMatchObject({
      left: 20,
      width: 83,
      font: "serif",
      target: { text: "Hello world" },
    });
  });
  it("leaves ambiguous, partial and locked targets read-only", () => {
    expect(
      pageTextAnchors(
        [run("same"), run("same", 80)],
        [paragraph("same"), paragraph("same", 1)],
        1,
        1,
      ),
    ).toEqual([]);
    expect(
      pageTextAnchors([run("same longer")], [paragraph("same")], 1, 1),
    ).toEqual([]);
    expect(
      pageTextAnchors(
        [run("same")],
        [{ ...paragraph("same"), editable: false }],
        1,
        1,
      ),
    ).toEqual([]);
  });
  it("uses slide geometry and page identity to distinguish repeated object text", () => {
    const objects = [20, 100].map((left, index) => ({
      text: "same",
      selection: { kind: "object" as const, index, page: 2 },
      bounds: {
        x: (left * 2540) / 72,
        y: (25 * 2540) / 72,
        width: (50 * 2540) / 72,
        height: (30 * 2540) / 72,
      },
    }));
    expect(
      pageTextAnchors([run("same"), run("same", 100)], objects, 1, 1),
    ).toEqual([]);
    expect(
      pageTextAnchors([run("same"), run("same", 100)], objects, 2, 1).map(
        (anchor) => anchor.left,
      ),
    ).toEqual([20, 100]);
  });
});
