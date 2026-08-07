const explicitScheme = /^[a-z][a-z\d+.-]*:/iu;
const hostWithPort =
  /^(?:localhost|127(?:\.\d{1,3}){3}|\[[^\]]+\]):\d+(?:\/|$)/iu;

export function normalizeBrowserAddress(address: string): string {
  const value = address.trim();
  if (!value) {
    throw new Error("Enter a web address.");
  }

  const candidate =
    explicitScheme.test(value) && !hostWithPort.test(value)
      ? value
      : `https://${value}`;
  const url = new URL(candidate);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Only HTTP and HTTPS addresses are supported.");
  }
  return url.href;
}
