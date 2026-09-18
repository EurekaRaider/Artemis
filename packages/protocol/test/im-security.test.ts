import { describe, expect, it } from "vitest";
import {
  imDataScopeSchema,
  isImProtectedPath,
  normalizeImPath,
  imPathWithinScope,
  imScopeCanWrite,
  imScopeConfirmation,
  imScopeRevision,
} from "../src/im-security.js";

describe("IM data boundaries", () => {
  it("requires explicit consent for future project writes and preserves legacy selected roots", () => {
    const legacy = imDataScopeSchema.parse({
      audience: "owner",
      readPaths: [],
      writePaths: ["src"],
    });
    expect(imScopeCanWrite(legacy, "new/file.ts")).toBe(false);
    const whole = imDataScopeSchema.parse({
      ...legacy,
      readMode: "project",
      writeMode: "project",
      writePaths: [],
    });
    expect(imScopeCanWrite(whole, "new/file.ts")).toBe(true);
    expect(
      imDataScopeSchema.safeParse({
        ...whole,
        readPaths: ["src"],
        readMode: "selected",
      }).success,
    ).toBe(false);
    expect(
      imDataScopeSchema.safeParse({ ...legacy, readMode: "selected" }).success,
    ).toBe(false);
  });
  it("isolates confirmation and revisions by audience with a legacy fallback", () => {
    const security = {
      version: 2 as const,
      revision: "old",
      confirmedAt: 10,
      scopes: [],
    };
    const scope = { audience: "owner", readPaths: [], writePaths: [] };
    expect(imScopeConfirmation(security, scope)).toBe(10);
    expect(imScopeRevision(security, scope)).toBe("old");
    expect(imScopeConfirmation(security, { ...scope, confirmedAt: 0 })).toBe(0);
    expect(imScopeRevision(security, { ...scope, revision: "own" })).toBe(
      "own",
    );
  });
  it.each([
    "../private",
    "/etc/passwd",
    "C:/secret",
    "src/../private",
    "src\\private",
    ".",
    "src/*",
    "src/file:stream",
    "src/file.",
    "src/COM¹",
    "src/LPT².txt",
  ])("rejects ambiguous scope %s", (path) => {
    expect(() => normalizeImPath(path)).toThrow();
  });
  it("does not confuse sibling prefixes", () => {
    expect(imPathWithinScope("src/main.ts", ["src"])).toBe(true);
    expect(imPathWithinScope("src-private/key", ["src"])).toBe(false);
  });
  it.each([
    "src/.env",
    "src/.env.production",
    "src/.git/hooks/post-checkout",
    "src/auth.json",
    "src/AGENTS.md",
    "src/private.pem",
    "resources/windows-im-files.cs",
    "resources/windows-sandbox.ps1",
  ])("protects %s at every depth", (path) => {
    expect(isImProtectedPath(path)).toBe(true);
  });
  it("allows examples and ordinary source", () => {
    expect(isImProtectedPath("src/.env.example")).toBe(false);
    expect(isImProtectedPath("src/password-input.tsx")).toBe(false);
  });
  it("rejects a write scope outside the read scope", () => {
    expect(
      imDataScopeSchema.safeParse({
        audience: "owner",
        readPaths: ["src"],
        writePaths: ["docs"],
      }).success,
    ).toBe(false);
  });
  it("treats empty read paths as the whole project root", () => {
    // Default grant: read everything, write nothing.
    expect(
      imDataScopeSchema.safeParse({
        audience: "owner",
        readPaths: [],
        writePaths: [],
      }).success,
    ).toBe(true);
    // With the whole root readable, writable paths are not constrained by it.
    expect(
      imDataScopeSchema.safeParse({
        audience: "owner",
        readPaths: [],
        writePaths: ["src"],
      }).success,
    ).toBe(true);
    // File roots (anti directory-swap markers) require explicit readable paths.
    expect(
      imDataScopeSchema.safeParse({
        audience: "owner",
        readPaths: [],
        filePaths: ["src/a.ts"],
        writePaths: [],
      }).success,
    ).toBe(false);
  });
});

it("allows a file-only write grant alongside whole-project reads without widening that file into a directory", () => {
  expect(
    imDataScopeSchema.safeParse({
      audience: "owner",
      readPaths: [],
      writePaths: ["README.md"],
      filePaths: ["README.md"],
    }).success,
  ).toBe(true);
  expect(
    imDataScopeSchema.safeParse({
      audience: "owner",
      readPaths: [],
      writePaths: [],
      filePaths: ["README.md"],
    }).success,
  ).toBe(false);
});
