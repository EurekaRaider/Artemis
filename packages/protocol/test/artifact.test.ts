import { describe, expect, it } from "vitest";
import {
  artifactOperationSchema,
  artifactSessionSchema,
  reduceArtifactEvent,
  restoreArtifactSnapshot,
  type ArtifactEvent,
  type ArtifactSession,
} from "../src/artifact.js";

const session: ArtifactSession = {
  protocolVersion: 1,
  documentId: "doc",
  sessionId: "session",
  path: "中文/report.docx",
  format: "word",
  engineVersion: "1.0.0",
  version: 0,
  savedVersion: 0,
  previewVersion: null,
  sequence: 1,
  status: "saved",
};
const event = (sequence: number, version = 0): ArtifactEvent => ({
  protocolVersion: 1,
  eventId: `e${sequence}`,
  kind: sequence === 1 ? "opened" : "applied",
  session: {
    ...session,
    sequence,
    version,
    status: version ? "editing" : "saved",
  },
});

describe("artifact projection", () => {
  it("deduplicates and requires a snapshot on missing or reordered events", () => {
    const initial = reduceArtifactEvent(undefined, event(1));
    expect(reduceArtifactEvent(initial, event(1))).toBe(initial);
    const gap = reduceArtifactEvent(initial, event(3, 2));
    expect(gap.needsSnapshot).toBe(true);
    expect(gap.session.version).toBe(0);
    expect(reduceArtifactEvent(gap, event(2, 1)).needsSnapshot).toBe(true);
    const restored = restoreArtifactSnapshot(gap, {
      session: event(3, 2).session,
      targets: [],
      sheets: [],
      warnings: [],
    });
    expect(restored.needsSnapshot).toBe(false);
    expect(reduceArtifactEvent(restored, event(2, 1))).toBe(restored);
  });
  it("does not let stale snapshots or foreign sessions replace current state", () => {
    const state = reduceArtifactEvent(undefined, event(3, 2));
    expect(
      restoreArtifactSnapshot(state, {
        session,
        targets: [],
        sheets: [],
        warnings: [],
      }),
    ).toBe(state);
    expect(
      reduceArtifactEvent(state, {
        ...event(4, 3),
        session: { ...session, sessionId: "other", sequence: 4 },
      }),
    ).toBe(state);
    const gap = reduceArtifactEvent(state, event(8, 7));
    expect(
      restoreArtifactSnapshot(gap, {
        session: event(7, 6).session,
        targets: [],
        sheets: [],
        warnings: [],
      }),
    ).toBe(gap);
  });
  it("separates disk, draft and preview versions", () => {
    expect(
      artifactSessionSchema.safeParse({
        ...session,
        version: 3,
        savedVersion: 1,
        previewVersion: 2,
        status: "editing",
      }).success,
    ).toBe(true);
    expect(
      artifactSessionSchema.safeParse({
        ...session,
        version: 3,
        savedVersion: 1,
        status: "saved",
      }).success,
    ).toBe(false);
    expect(
      artifactSessionSchema.safeParse({ ...session, previewVersion: 1 })
        .success,
    ).toBe(false);
  });
  it("bounds selections and rectangular cell mutations before execution", () => {
    expect(
      artifactOperationSchema.safeParse({
        type: "replace-text",
        paragraph: 0,
        start: 5,
        end: 2,
        text: "bad",
      }).success,
    ).toBe(false);
    expect(
      artifactOperationSchema.safeParse({
        type: "set-cells",
        sheet: "Sheet1",
        row: 1_048_576,
        column: 1,
        values: [[1], [2]],
      }).success,
    ).toBe(false);
    expect(
      artifactOperationSchema.safeParse({
        type: "set-cells",
        sheet: "Sheet1",
        row: 1,
        column: 1,
        values: [[1], [2, 3]],
      }).success,
    ).toBe(false);
  });
  it("bounds object edits and rejects arbitrary native properties", () => {
    const change = { type: "move-object", page: 1, object: 0, x: 1200, y: 800 };
    expect(artifactOperationSchema.safeParse(change).success).toBe(true);
    for (const invalid of [
      { ...change, x: Infinity },
      { ...change, path: Array(17).fill(0) },
      { ...change, property: "MacroExecutionMode" },
      { ...change, page: 0 },
    ])
      expect(artifactOperationSchema.safeParse(invalid).success).toBe(false);
  });
});
