export async function downloadPublicMacOfficeCatalog(
  candidate,
  version,
  request = fetch,
) {
  const url = `https://github.com/EurekaRaider/Artemis/releases/download/office-runtime-v${version}/catalog.json`;
  const response = await request(url, { signal: AbortSignal.timeout(60_000) });
  if (
    !response.ok ||
    !response.body ||
    new URL(response.url || url).protocol !== "https:"
  )
    throw new Error("Anonymous Office catalog download failed");
  const chunks = [];
  let bytes = 0;
  for await (const chunk of response.body) {
    bytes += chunk.length;
    if (bytes > 16 * 1024 * 1024)
      throw new Error("Public Office catalog is too large");
    chunks.push(Buffer.from(chunk));
  }
  const content = Buffer.concat(chunks);
  if (!content.equals(Buffer.from(candidate)))
    throw new Error(
      "Public Office catalog differs from the accepted candidate",
    );
  return { content, url };
}
