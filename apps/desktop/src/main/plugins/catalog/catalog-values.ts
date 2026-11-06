export function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

export function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function safeRemoteUrl(value: unknown): string | undefined {
  const urlText = text(value);
  if (!urlText || urlText.includes("{")) return undefined;
  try {
    const url = new URL(urlText);
    const loopback =
      url.hostname === "127.0.0.1" ||
      url.hostname === "localhost" ||
      url.hostname === "::1" ||
      url.hostname === "[::1]";
    return !url.username &&
      !url.password &&
      !url.hash &&
      (url.protocol === "https:" || (url.protocol === "http:" && loopback))
      ? url.href
      : undefined;
  } catch {
    return undefined;
  }
}

export async function responseJson(
  response: Response,
  source: string,
): Promise<unknown> {
  if (!response.ok) {
    throw new Error(`${source} request failed (${response.status}).`);
  }
  return response.json() as Promise<unknown>;
}

export function encodedPath(segments: string[]): string {
  return segments.map((segment) => encodeURIComponent(segment)).join("/");
}
