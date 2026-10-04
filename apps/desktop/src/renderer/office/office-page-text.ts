import type { ArtifactSnapshot } from "@artemis/protocol";
import { officeTargetKey } from "./office-editor-state.js";

export interface PageTextRun {
  text: string;
  left: number;
  top: number;
  width: number;
  height: number;
  font: string;
}
export interface PageTextAnchor {
  key: string;
  target: ArtifactSnapshot["targets"][number];
  left: number;
  top: number;
  width: number;
  height: number;
  fontSize: number;
  lineHeight: number;
  font: string;
}
const normalized = (text: string) => text.normalize("NFKC").replace(/\s/gu, "");

/** Pad small text targets, stopping at the gap to neighbouring text. */
export function pageTextHitBounds(
  anchor: PageTextAnchor,
  anchors: PageTextAnchor[],
) {
  const { left: x, top: y, width, height } = anchor;
  if (anchor.target.selection.kind !== "paragraph")
    return { left: x, top: y, width, height };
  const padX = Math.max(4, (28 - width) / 2);
  const padY = Math.max(4, (24 - height) / 2);
  let left = Math.max(0, x - padX),
    right = x + width + padX;
  let top = Math.max(0, y - padY),
    bottom = y + height + padY;
  for (const other of anchors) {
    if (other === anchor) continue;
    const otherRight = other.left + other.width;
    const otherBottom = other.top + other.height;
    if (other.top < bottom && otherBottom > top) {
      if (otherRight <= x) left = Math.max(left, (otherRight + x) / 2);
      if (other.left >= x + width)
        right = Math.min(right, (x + width + other.left) / 2);
    }
    if (other.left < right && otherRight > left) {
      if (otherBottom <= y) top = Math.max(top, (otherBottom + y) / 2);
      if (other.top >= y + height)
        bottom = Math.min(bottom, (y + height + other.top) / 2);
    }
  }
  return { left, top, width: right - left, height: bottom - top };
}

/** Only expose edits when visible PDF text identifies a native target uniquely. */
export function pageTextAnchors(
  runs: PageTextRun[],
  targets: ArtifactSnapshot["targets"],
  page: number,
  scale: number,
): PageTextAnchor[] {
  let text = "";
  const indexed = runs.map((run) => {
    const start = text.length;
    text += normalized(run.text);
    return { ...run, start, end: text.length };
  });
  const counts = new Map<string, number>();
  let nativeText = "";
  const paragraphs = targets
    .filter(
      (target) =>
        target.selection.kind === "paragraph" && normalized(target.text),
    )
    .map((target) => {
      const value = normalized(target.text);
      counts.set(value, (counts.get(value) ?? 0) + 1);
      const start = nativeText.length;
      nativeText += value;
      return { target, value, start, end: nativeText.length };
    });
  const paragraphIndices = new Map(
    paragraphs.map(({ target }, index) => [target, index]),
  );
  const runStarts = new Set(indexed.map((run) => run.start));
  const runEnds = new Set(indexed.map((run) => run.end));
  return targets.flatMap((target) => {
    const selection = target.selection;
    if (
      target.editable === false ||
      (selection.kind !== "paragraph" && selection.kind !== "object") ||
      (selection.kind === "object" && selection.page !== page)
    )
      return [];
    const value = normalized(target.text);
    if (!value) return [];
    let candidates: (typeof indexed)[] = [];
    for (
      let start = text.indexOf(value);
      start >= 0;
      start = text.indexOf(value, start + 1)
    ) {
      const end = start + value.length;
      const match = indexed.filter((run) => run.end > start && run.start < end);
      if (
        !match.length ||
        match[0]!.start !== start ||
        match.at(-1)!.end !== end
      )
        continue;
      if (selection.kind === "object" && target.bounds) {
        const unit = (scale * 72) / 2540;
        const bounds = target.bounds;
        if (
          !match.every(
            (run) =>
              run.left + run.width / 2 >= bounds.x * unit - 2 &&
              run.left + run.width / 2 <=
                (bounds.x + bounds.width) * unit + 2 &&
              run.top + run.height / 2 >= bounds.y * unit - 2 &&
              run.top + run.height / 2 <= (bounds.y + bounds.height) * unit + 2,
          )
        )
          continue;
      }
      candidates.push(match);
    }
    if (
      selection.kind === "paragraph" &&
      (counts.get(value) !== 1 || candidates.length > 1)
    ) {
      // Repeated cells need a phrase unique in both the native document and PDF.
      // Never assign duplicates by occurrence number: pages/headers can differ.
      const index = paragraphIndices.get(target)!;
      const positions = new Set<number>();
      for (const [from, to] of [
        [index - 1, index + 1],
        [index - 1, index],
        [index, index + 1],
      ]) {
        const first = paragraphs[from!],
          last = paragraphs[to!];
        if (!first || !last || (first.value === value && last.value === value))
          continue;
        const context = nativeText.slice(first.start, last.end);
        if (
          nativeText.indexOf(context) !== first.start ||
          nativeText.lastIndexOf(context) !== first.start
        )
          continue;
        const start = text.indexOf(context);
        if (
          start < 0 ||
          text.indexOf(context, start + 1) >= 0 ||
          !runStarts.has(start) ||
          !runEnds.has(start + context.length)
        )
          continue;
        positions.add(start + paragraphs[index]!.start - first.start);
      }
      if (positions.size !== 1) return [];
      const [start] = positions;
      candidates = candidates.filter((match) => match[0]!.start === start);
    }
    if (
      !candidates.length &&
      selection.kind === "object" &&
      !selection.cell &&
      target.bounds
    ) {
      // WordArt can export as paths with no PDF text. Its native object bounds
      // still identify the exact editable object; the engine restores its effect.
      const unit = (scale * 72) / 2540;
      const bounds = target.bounds;
      const height = bounds.height * unit;
      const fontSize = Math.max(
        8 * scale,
        Math.min(
          20 * scale,
          (height / Math.max(1, target.text.split("\n").length)) * 0.8,
        ),
      );
      return [
        {
          key: officeTargetKey(target),
          target,
          left: bounds.x * unit,
          top: bounds.y * unit,
          width: bounds.width * unit,
          height,
          fontSize,
          lineHeight: fontSize * 1.2,
          font: "sans-serif",
        },
      ];
    }
    if (candidates.length !== 1) return [];
    const match = candidates[0]!;
    const first = match[0]!;
    const left = Math.min(...match.map((run) => run.left));
    const top = Math.min(...match.map((run) => run.top));
    const right = Math.max(...match.map((run) => run.left + run.width));
    const bottom = Math.max(...match.map((run) => run.top + run.height));
    const lines = [...new Set(match.map((run) => Math.round(run.top)))].sort(
      (a, b) => a - b,
    );
    const lineHeight =
      lines.length > 1
        ? Math.max(first.height, lines[1]! - lines[0]!)
        : first.height * 1.2;
    return [
      {
        key: officeTargetKey(target),
        target,
        left,
        top: top - (lineHeight - first.height) / 2,
        width: Math.max(
          selection.kind === "paragraph" ? 1 : 24,
          right - left + 3,
        ),
        height: Math.max(
          lineHeight,
          bottom - top + (lineHeight - first.height),
        ),
        fontSize: first.height,
        lineHeight,
        font: first.font,
      },
    ];
  });
}
