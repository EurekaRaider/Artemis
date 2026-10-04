import { describe, expect, it } from "vitest";
import {
  RESTRICTED_PROFILE,
  SUBMISSION_TRANSITIONS,
  hashSubmissionPayload,
  isDeniedByRestrictedProfile,
  isValidSubmissionTransition,
  pluginManifestSchema,
} from "../src/design-plugin.js";

const validManifest = {
  schemaVersion: 1,
  id: "com.artemis.design",
  version: "0.1.0",
  engines: { artemisPluginApi: "1" },
  projectTypes: [
    {
      id: "artemis-design",
      title: { "zh-CN": "设计", en: "Design" },
      targets: ["project", "temporary"],
      panelIds: ["studio"],
    },
  ],
  panels: [{ id: "studio", entry: "panel/index.html" }],
  runtime: { entry: "runtime/index.mjs", protocolVersion: 1 },
  tools: [
    {
      name: "replace_document",
      description: "Replace the design document snapshot.",
      effect: "artifact-write",
    },
  ],
  capabilities: {
    artifactStore: "thread",
    projectFiles: "explicit-import",
    network: "none",
    sessionInput: "host-user-action",
  },
};

describe("pluginManifestSchema (S0)", () => {
  it("accepts a well-formed manifest", () => {
    expect(() => pluginManifestSchema.parse(validManifest)).not.toThrow();
  });

  it("rejects unknown top-level keys", () => {
    expect(() =>
      pluginManifestSchema.parse({ ...validManifest, extra: true }),
    ).toThrow();
  });

  it("rejects a manifest without project types", () => {
    expect(() =>
      pluginManifestSchema.parse({ ...validManifest, projectTypes: [] }),
    ).toThrow();
  });

  it("rejects network capability other than none in S0", () => {
    expect(() =>
      pluginManifestSchema.parse({
        ...validManifest,
        capabilities: { ...validManifest.capabilities, network: "https" },
      }),
    ).toThrow();
  });

  it("rejects an unsupported protocol version", () => {
    expect(() =>
      pluginManifestSchema.parse({
        ...validManifest,
        runtime: { ...validManifest.runtime, protocolVersion: 2 },
      }),
    ).toThrow();
  });
});

describe("restricted profile (S0)", () => {
  it("denies every escalation capability from the proposal §7 matrix", () => {
    for (const capability of Object.keys(RESTRICTED_PROFILE.denies)) {
      expect(
        isDeniedByRestrictedProfile(
          capability as keyof typeof RESTRICTED_PROFILE.denies,
        ),
      ).toBe(true);
    }
  });

  it("keeps the profile id stable for thread bindings", () => {
    expect(RESTRICTED_PROFILE.id).toBe("plugin-restricted-v1");
  });
});

describe("submission ledger (S0)", () => {
  it("hashes payloads deterministically", () => {
    expect(hashSubmissionPayload("把这个按钮改为深绿")).toBe(
      hashSubmissionPayload("把这个按钮改为深绿"),
    );
    expect(hashSubmissionPayload("a")).not.toBe(hashSubmissionPayload("b"));
  });

  it("allows exactly the legal state machine transitions", () => {
    expect(isValidSubmissionTransition("prepared", "accepted")).toBe(true);
    expect(isValidSubmissionTransition("accepted", "queued")).toBe(true);
    expect(isValidSubmissionTransition("queued", "dispatching")).toBe(true);
    expect(isValidSubmissionTransition("dispatching", "running")).toBe(true);
    expect(isValidSubmissionTransition("running", "completed")).toBe(true);
    expect(isValidSubmissionTransition("running", "unknown")).toBe(true);
  });

  it("rejects illegal transitions including skips and replays", () => {
    expect(isValidSubmissionTransition("prepared", "running")).toBe(false);
    expect(isValidSubmissionTransition("completed", "queued")).toBe(false);
    expect(isValidSubmissionTransition("failed", "queued")).toBe(false);
    expect(isValidSubmissionTransition("cancelled", "accepted")).toBe(false);
    expect(isValidSubmissionTransition("completed", "unknown")).toBe(false);
  });

  it("makes terminal states terminal", () => {
    expect(SUBMISSION_TRANSITIONS.completed).toEqual([]);
    expect(SUBMISSION_TRANSITIONS.failed).toEqual([]);
    expect(SUBMISSION_TRANSITIONS.cancelled).toEqual([]);
  });
});
