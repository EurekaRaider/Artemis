import { HardDrives } from "@phosphor-icons/react";

// Explicit IDs prevent unrelated providers from inheriting another brand's logo.
export const PROVIDER_BRAND_ICONS: Readonly<Record<string, string>> = {
  "amazon-bedrock": "bedrock",
  "ant-ling": "ant-ling",
  anthropic: "anthropic",
  "azure-openai-responses": "azure",
  baseten: "baseten",
  cerebras: "cerebras",
  "cloudflare-ai-gateway": "cloudflare",
  "cloudflare-workers-ai": "workersai",
  deepseek: "deepseek",
  fireworks: "fireworks",
  "github-copilot": "githubcopilot",
  google: "google",
  "google-vertex": "vertexai",
  groq: "groq",
  huggingface: "huggingface",
  "kimi-coding": "kimi",
  meta: "meta",
  minimax: "minimax",
  "minimax-cn": "minimax",
  mistral: "mistral",
  moonshotai: "moonshot",
  "moonshotai-cn": "moonshot",
  nvidia: "nvidia",
  openai: "openai",
  "openai-codex": "openai",
  opencode: "opencode",
  "opencode-go": "opencode",
  openrouter: "openrouter",
  "qwen-token-plan": "qwen",
  "qwen-token-plan-cn": "qwen",
  "qwen-token-plan-individual": "qwen",
  radius: "radius",
  together: "together",
  typesafe: "typesafe",
  "vercel-ai-gateway": "vercel",
  xai: "xai",
  xiaomi: "xiaomimimo",
  "xiaomi-token-plan-ams": "xiaomimimo",
  "xiaomi-token-plan-cn": "xiaomimimo",
  "xiaomi-token-plan-sgp": "xiaomimimo",
  zai: "zai",
  "zai-coding-cn": "zai",
};

/** All brand assets are bundled locally. See assets/brand-sources.json. */
export function ProviderIcon({
  providerId,
  custom = false,
}: {
  providerId: string;
  custom?: boolean;
}) {
  const asset = custom
    ? undefined
    : PROVIDER_BRAND_ICONS[providerId.toLowerCase()];
  if (asset)
    return (
      <span
        className={`provider-brand-icon provider-brand-icon-${asset}`}
        aria-hidden="true"
      />
    );
  if (custom)
    return (
      <HardDrives
        className="provider-brand-icon"
        aria-hidden="true"
        size={30}
        weight="regular"
      />
    );
  // Unknown future providers stay identifiable without inventing a brand mark.
  return (
    <span
      className="provider-brand-icon provider-brand-initial"
      aria-hidden="true"
    >
      {providerId.slice(0, 2).toUpperCase()}
    </span>
  );
}
