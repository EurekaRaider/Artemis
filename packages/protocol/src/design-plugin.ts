// Design-plugin binding and persisted prompt-submission ledger contracts.
// Submissions retain their identity across restarts without replaying effects.

import { z } from "zod";

// Minimal FIPS 180-4 SHA-256 (pure TypeScript) so this module has no Node or
// DOM dependency. The ledger only needs a stable content hash, not constant
// time; hash comparison is never used as a secret check.
function sha256Hex(input: string): string {
  const K = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1,
    0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
    0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
    0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
    0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
    0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
    0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
    0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
    0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ];
  const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n));
  const bytes = new TextEncoder().encode(input);
  const bitLen = bytes.length * 8;
  const padded = new Uint8Array((((bytes.length + 8) >> 6) + 1) << 6);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const dv = new DataView(padded.buffer);
  dv.setUint32(padded.length - 4, bitLen >>> 0);
  dv.setUint32(padded.length - 8, Math.floor(bitLen / 0x100000000));
  const H = [
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c,
    0x1f83d9ab, 0x5be0cd19,
  ];
  const w = new Int32Array(64);
  for (let offset = 0; offset < padded.length; offset += 64) {
    for (let i = 0; i < 16; i++) w[i] = dv.getInt32(offset + i * 4);
    for (let i = 16; i < 64; i++) {
      const w15 = w[i - 15] ?? 0;
      const w2 = w[i - 2] ?? 0;
      const w16 = w[i - 16] ?? 0;
      const w7 = w[i - 7] ?? 0;
      const s0 = rotr(w15, 7) ^ rotr(w15, 18) ^ (w15 >>> 3);
      const s1 = rotr(w2, 17) ^ rotr(w2, 19) ^ (w2 >>> 10);
      w[i] = (w16 + s0 + w7 + s1) | 0;
    }
    let a = H[0] ?? 0,
      b = H[1] ?? 0,
      c = H[2] ?? 0,
      d = H[3] ?? 0;
    let e = H[4] ?? 0,
      f = H[5] ?? 0,
      g = H[6] ?? 0,
      h = H[7] ?? 0;
    for (let i = 0; i < 64; i++) {
      const ki = K[i] ?? 0;
      const wi = w[i] ?? 0;
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (h + S1 + ch + ki + wi) | 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) | 0;
      h = g;
      g = f;
      f = e;
      e = (d + t1) | 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) | 0;
    }
    H[0] = ((H[0] ?? 0) + a) | 0;
    H[1] = ((H[1] ?? 0) + b) | 0;
    H[2] = ((H[2] ?? 0) + c) | 0;
    H[3] = ((H[3] ?? 0) + d) | 0;
    H[4] = ((H[4] ?? 0) + e) | 0;
    H[5] = ((H[5] ?? 0) + f) | 0;
    H[6] = ((H[6] ?? 0) + g) | 0;
    H[7] = ((H[7] ?? 0) + h) | 0;
  }
  return H.map((x) => (x >>> 0).toString(16).padStart(8, "0")).join("");
}

export {
  pluginManifestSchema,
  type PluginManifest,
} from "@artemis/plugin-contract";

/** @deprecated Legacy persisted identifiers; Design uses ordinary mode/tool policy. */
export const RESTRICTED_PROFILE_ID = "plugin-restricted-v1";
/** @deprecated Legacy persisted identifier, ignored by current sessions. */
export const STANDARD_DESIGN_PROFILE_ID = "plugin-standard-v1";

/** @deprecated Design no longer has a separate thread permission tier. */
export function isRestrictedDesignThread(_thread: {
  executionProfile?: string | undefined;
  typeBinding?: unknown;
}): boolean {
  return false;
}

export const pluginTypeBindingSchema = z.strictObject({
  installationId: z.string().min(1),
  pluginId: z.string().min(1),
  typeId: z.string().min(1),
  pluginVersion: z.string().min(1),
  contentHash: z.string().min(8),
  bindingRevision: z.string().min(1),
});

export type PluginTypeBinding = z.infer<typeof pluginTypeBindingSchema>;

/**
 * @deprecated Historical capability matrix retained for API compatibility.
 * Current Design sessions do not consult this profile.
 */
export const RESTRICTED_PROFILE = {
  id: RESTRICTED_PROFILE_ID,
  allows: {
    piConversation: true,
    hostClarification: true,
    resultSummary: true,
    pluginRuntimeWhenTrusted: true,
    pluginArtifactWriteViaHost: true,
    importedDataRead: true,
  },
  denies: {
    projectReadWrite: true,
    piBash: true,
    mcp: true,
    executableExtensions: true,
    commandHooks: true,
    subagents: true,
    imOutbound: true,
    automation: true,
    crossThreadMessaging: true,
    computerUse: true,
  },
} as const;

export type RestrictedProfileCapability =
  keyof typeof RESTRICTED_PROFILE.denies;

/** Check whether a named host capability is denied by the restricted profile. */
export function isDeniedByRestrictedProfile(
  capability: RestrictedProfileCapability,
): boolean {
  return RESTRICTED_PROFILE.denies[capability] === true;
}

// ---------------------------------------------------------------------------
// Prompt submission ledger (S0 slice of proposal §9.3)
// ---------------------------------------------------------------------------

export const SUBMISSION_STATES = [
  "prepared",
  "accepted",
  "queued",
  "dispatching",
  "running",
  "completed",
  "failed",
  "cancelled",
  "unknown",
] as const;

export type SubmissionState = (typeof SUBMISSION_STATES)[number];

export interface SubmissionLedgerRecord {
  submissionId: string;
  threadId: string;
  /** Origin of the candidate text: "panel" | "composer". */
  source: "panel" | "composer";
  /** Verbatim candidate text at accept time. */
  candidateText: string;
  /** SHA-256 hex of candidateText at accept time. */
  payloadHash: string;
  /** Monotonic per-thread sequence assigned at accept. */
  sequence: number;
  state: SubmissionState;
  turnId: string | null;
  /** Binding snapshot captured at accept; re-verified before dispatch. */
  bindingRevision: string;
  /** Why the state moved; audit trail only. */
  lastTransitionReason: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Compute the payload hash used for idempotency: the same submissionId must
 * always carry the same payload, otherwise the ledger record is corrupt and
 * the caller must refuse to act on it. Uses a pure-JS SHA-256 so the protocol
 * package stays importable from the renderer without Node builtins.
 */
export function hashSubmissionPayload(text: string): string {
  return sha256Hex(text);
}

export const SUBMISSION_TRANSITIONS: Readonly<
  Record<SubmissionState, readonly SubmissionState[]>
> = Object.freeze({
  prepared: ["accepted", "cancelled"],
  accepted: ["queued", "cancelled"],
  queued: ["dispatching", "cancelled"],
  dispatching: ["running", "failed", "unknown"],
  running: ["completed", "failed", "cancelled", "unknown"],
  completed: [],
  failed: [],
  cancelled: [],
  unknown: ["failed", "completed"],
});

/** Validate a state transition against the ledger state machine. */
export function isValidSubmissionTransition(
  from: SubmissionState,
  to: SubmissionState,
): boolean {
  return SUBMISSION_TRANSITIONS[from].includes(to);
}
