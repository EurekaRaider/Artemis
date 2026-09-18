import { z } from "zod";

export const IM_SECURITY_VERSION = 2 as const;

/** One canonical, platform-independent project-relative spelling. No globs. */
export function normalizeImPath(value: string): string {
  const parts = value.split("/");
  if (
    !value ||
    value.length > 4096 ||
    /[\\:*?\[\]{}\x00-\x1f]/u.test(value) ||
    parts.some(
      (p) =>
        !p ||
        p === "." ||
        p === ".." ||
        /[. ]$/u.test(p) ||
        /^(?:con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/iu.test(p),
    )
  )
    throw new Error(
      "Choose an explicit project-relative file or directory (no wildcards).",
    );
  return value;
}
export function imPathWithinScope(
  path: string,
  roots: readonly string[],
): boolean {
  return roots.some((root) => path === root || path.startsWith(`${root}/`));
}
/** Shared with the Windows native broker; no runtime/user-controlled pattern. */
export const IM_PROTECTED_COMPONENT =
  /(?:^(?:\.env(?:\..*)?|\.git|\.ssh|\.aws|\.azure|\.kube|\.gnupg|\.codex|\.claude|\.artemis|\.pi|\.vscode|\.idea|\.github|\.cursor|\.windsurf|\.mcp\.json|mcp\.json|opencode\.jsonc?|claude_desktop_config\.json|windows-im-files\.(?:cs|ps1)|windows-sandbox(?:-setup)?\.ps1|\.npmrc|\.pypirc|\.netrc|auth\.json|credentials(?:\.json)?|agents\.md|skill\.md|id_(?:rsa|dsa|ecdsa|ed25519)(?:\.pub)?)$)|(?:\.(?:pem|key|p12|pfx|keystore)$)/iu;
export function isImProtectedPath(path: string): boolean {
  return path.split("/").some((p) => {
    const name = p.toLowerCase();
    if ([".env.example", ".env.sample", ".env.template"].includes(name))
      return false;
    return IM_PROTECTED_COMPONENT.test(p);
  });
}
const pathSchema = z.string().superRefine((path, ctx) => {
  try {
    normalizeImPath(path);
  } catch {
    ctx.addIssue({ code: "custom", message: "Invalid project-relative path" });
  }
  if (isImProtectedPath(path))
    ctx.addIssue({
      code: "custom",
      message: "Protected files require the private desktop workspace",
    });
});
export const imDataScopeSchema = z
  .object({
    audience: z.string().min(1).max(1024),
    revision: z.string().min(1).max(256).optional(),
    contextRevision: z.string().min(1).max(256).optional(),
    confirmedAt: z.number().int().nonnegative().optional(),
    readMode: z.enum(["project", "selected"]).optional(),
    writeMode: z.enum(["project", "selected"]).optional(),
    spaceRevision: z.string().min(1).max(256).optional(),
    filePaths: z.array(pathSchema).max(256).optional(),
    readPaths: z.array(pathSchema).max(256),
    writePaths: z.array(pathSchema).max(256),
  })
  .strict()
  .superRefine((scope, ctx) => {
    // An empty readPaths grants the whole project root (default grant: read
    // everything, write nothing), so writable paths are not constrained by
    // it; non-empty readPaths keep the explicit subset invariants.
    const wholeProject = scope.readPaths.length === 0;
    if (
      (scope.readMode === "project" && !wholeProject) ||
      (scope.readMode === "selected" && wholeProject) ||
      (scope.writeMode === "project" && !wholeProject)
    )
      ctx.addIssue({
        code: "custom",
        message:
          "Project access must be explicit and writable scope must remain readable",
      });
    if (
      wholeProject &&
      scope.filePaths?.some((path) => !scope.writePaths.includes(path))
    )
      ctx.addIssue({
        code: "custom",
        message: "File roots require explicit readable or writable paths",
      });
    if (
      !wholeProject &&
      scope.filePaths?.some((p) => !scope.readPaths.includes(p))
    )
      ctx.addIssue({
        code: "custom",
        message: "File roots must be explicitly readable",
      });
    if (
      !wholeProject &&
      scope.writePaths.some((p) => !imPathWithinScope(p, scope.readPaths))
    )
      ctx.addIssue({
        code: "custom",
        message: "Writable paths must be inside readable paths",
      });
  });
export type ImDataScope = z.infer<typeof imDataScopeSchema>;
export function imScopeCanWrite(scope: ImDataScope, path: string): boolean {
  return (
    scope.writeMode === "project" || imPathWithinScope(path, scope.writePaths)
  );
}
export function imScopeConfirmation(
  security: { confirmedAt: number } | undefined,
  scope: ImDataScope,
): number {
  return scope.confirmedAt ?? security?.confirmedAt ?? 0;
}
export function imScopeRevision(
  security: { revision: string },
  scope: ImDataScope,
): string {
  return scope.revision ?? security.revision;
}
export const imGrantSecuritySchema = z
  .object({
    version: z.literal(IM_SECURITY_VERSION),
    revision: z.string().min(1).max(256),
    confirmedAt: z.number().int().nonnegative(),
    scopes: z.array(imDataScopeSchema).max(101),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (
      new Set(value.scopes.map((s) => s.audience)).size !== value.scopes.length
    )
      ctx.addIssue({ code: "custom", message: "Duplicate audience scopes" });
  });
export interface ImSecurityContext {
  version: typeof IM_SECURITY_VERSION;
  projectId: string;
  revision: string;
  contextRevision?: string;
  audience: string;
  identityKey: string;
  source: "owner" | "member" | "desktop" | "tool-result";
  messageId: string;
  spaceRevision?: string;
}
export const imDeliverySecuritySchema = z
  .object({
    version: z.literal(IM_SECURITY_VERSION),
    projectId: z.string().min(1),
    revision: z.string().min(1),
    audience: z.string().min(1),
  })
  .strict();
export interface ImOutboundCandidate {
  id: string;
  threadId: string;
  kind: "reply" | "collaborate" | "artifact";
  contentHash: string;
  security: ImSecurityContext;
  expiresAt: number;
  state: "pending" | "sending" | "sent" | "rejected" | "expired";
  reason: string;
}
export interface ImScopeEntry {
  path: string;
  directory: boolean;
  protected: boolean;
}
