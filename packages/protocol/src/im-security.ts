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
    spaceRevision: z.string().min(1).max(256).optional(),
    filePaths: z.array(pathSchema).max(256).optional(),
    readPaths: z.array(pathSchema).max(256),
    writePaths: z.array(pathSchema).max(256),
  })
  .strict()
  .superRefine((scope, ctx) => {
    if (scope.filePaths?.some((p) => !scope.readPaths.includes(p)))
      ctx.addIssue({
        code: "custom",
        message: "File roots must be explicitly readable",
      });
    if (scope.writePaths.some((p) => !imPathWithinScope(p, scope.readPaths)))
      ctx.addIssue({
        code: "custom",
        message: "Writable paths must be inside readable paths",
      });
  });
export type ImDataScope = z.infer<typeof imDataScopeSchema>;
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
