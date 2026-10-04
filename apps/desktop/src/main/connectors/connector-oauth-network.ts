import { lookup as dnsLookup } from "node:dns/promises";
import { request } from "node:https";
import { BlockList, isIP, type LookupFunction } from "node:net";
import { Readable } from "node:stream";
import { publicOAuthUrl } from "../../shared/connector-oauth.js";

const blocked = new BlockList();
for (const [network, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const)
  blocked.addSubnet(network, prefix, "ipv4");
const globalV6 = new BlockList();
globalV6.addSubnet("2000::", 3, "ipv6");
for (const [network, prefix] of [
  ["2001::", 23],
  ["2001:db8::", 32],
  ["2002::", 16],
  ["3fff::", 20],
] as const)
  blocked.addSubnet(network, prefix, "ipv6");
export function isPublicOAuthAddress(address: string): boolean {
  const family = isIP(address);
  return family === 4
    ? !blocked.check(address, "ipv4")
    : family === 6 &&
        globalV6.check(address, "ipv6") &&
        !blocked.check(address, "ipv6");
}
type Resolver = (
  host: string,
) => Promise<Array<{ address: string; family: number }>>;
const fakeIp = new BlockList();
fakeIp.addSubnet("198.18.0.0", 15, "ipv4");

// A fixed public bootstrap address avoids the system Fake-IP resolver. TLS still
// verifies cloudflare-dns.com; no OAuth headers, codes or tokens reach this service.
async function securePublicLookup(
  host: string,
): Promise<Array<{ address: string; family: number }>> {
  return new Promise((resolve, reject) => {
    const query = new URL("https://cloudflare-dns.com/dns-query");
    query.search = new URLSearchParams({ name: host, type: "A" }).toString();
    const connection = request(
      query,
      {
        headers: { Accept: "application/dns-json" },
        agent: false,
        lookup: (_host, options, callback) => {
          if (options.all)
            (
              callback as unknown as (
                error: null,
                addresses: Array<{ address: string; family: number }>,
              ) => void
            )(null, [{ address: "1.1.1.1", family: 4 }]);
          else callback(null, "1.1.1.1", 4);
        },
      },
      (response) => {
        if (response.statusCode !== 200) {
          response.destroy();
          reject(new Error("Secure OAuth DNS lookup failed."));
          return;
        }
        const chunks: Buffer[] = [];
        let size = 0;
        response.on("data", (chunk) => {
          size += chunk.length;
          if (size > 65536)
            response.destroy(
              new Error("Secure OAuth DNS response is too large."),
            );
          else chunks.push(Buffer.from(chunk));
        });
        response.on("error", reject);
        response.on("end", () => {
          try {
            const data = JSON.parse(Buffer.concat(chunks).toString("utf8"));
            if (data.Status !== 0 || data.TC || !Array.isArray(data.Answer))
              throw new Error("Invalid DNS response");
            const addresses = data.Answer.filter(
              (answer: { type: number }) => answer.type === 1,
            ).map((answer: { data: string }) => ({
              address: answer.data,
              family: 4,
            }));
            if (
              !addresses.length ||
              addresses.some(
                (answer: { address: string }) =>
                  !isPublicOAuthAddress(answer.address),
              )
            )
              throw new Error("Non-public DNS answer");
            resolve(addresses);
          } catch {
            reject(
              new Error(
                "Secure OAuth DNS did not return public network addresses.",
              ),
            );
          }
        });
      },
    );
    const timeout = setTimeout(
      () => connection.destroy(new Error("Secure OAuth DNS lookup timed out.")),
      10000,
    );
    connection.on("close", () => clearTimeout(timeout));
    connection.on("error", reject);
    connection.end();
  });
}

export async function resolveOAuthAddresses(
  host: string,
  systemLookup: Resolver = (name) =>
    dnsLookup(name, { all: true, verbatim: true }),
  secureLookup: Resolver = securePublicLookup,
): Promise<Array<{ address: string; family: number }>> {
  let addresses = await systemLookup(host);
  const isFake = (value: { address: string }) =>
    isIP(value.address) === 4 && fakeIp.check(value.address, "ipv4");
  if (
    addresses.some(isFake) &&
    addresses.every(
      (value) => isFake(value) || isPublicOAuthAddress(value.address),
    )
  )
    addresses = await secureLookup(host);
  if (
    !addresses.length ||
    addresses.some((value) => !isPublicOAuthAddress(value.address))
  )
    throw new Error("OAuth connections require public network addresses.");
  return addresses;
}

export function createOAuthLookup(
  resolve: Resolver = resolveOAuthAddresses,
): LookupFunction {
  return (host, options, callback) => {
    void resolve(host)
      .then((addresses) => {
        if (
          !addresses.length ||
          addresses.some((a) => !isPublicOAuthAddress(a.address))
        )
          throw new Error(
            "OAuth connections require public network addresses.",
          );
        const candidates = options.family
          ? addresses.filter((a) => a.family === options.family)
          : addresses;
        if (!candidates.length)
          throw new Error("OAuth address family is unavailable.");
        // These addresses are passed straight to the connecting socket. No second DNS lookup.
        if (options.all)
          (
            callback as unknown as (
              error: null,
              addresses: typeof candidates,
            ) => void
          )(null, candidates);
        else callback(null, candidates[0]!.address, candidates[0]!.family);
      })
      .catch((error) => callback(error, "", 0));
  };
}

/** The browser owns its socket; preflight its destination without sending credentials. */
export async function assertPublicOAuthBrowserUrl(
  value: string,
): Promise<void> {
  const url = new URL(value);
  url.search = "";
  // Browser DNS/proxy routing belongs to the user's browser. No host credentials
  // are sent here; reject unsafe URL forms, not a browser-independent DNS result.
  publicOAuthUrl(url.href);
}

/** Fetch-compatible transport with DNS checks on the actual TLS socket, no redirects/cookies. */
export const fetchPublicOAuth: typeof fetch = async (input, init) => {
  const req = new Request(input, init);
  const url = new URL(req.url);
  const withoutQuery = new URL(url);
  withoutQuery.search = "";
  publicOAuthUrl(withoutQuery.href);
  if (
    url.hash ||
    req.headers.has("cookie") ||
    req.headers.has("proxy-authorization")
  )
    throw new Error("Unsafe OAuth request.");
  const body = req.body ? Buffer.from(await req.arrayBuffer()) : undefined;
  if (body && body.length > 1024 * 1024)
    throw new Error("OAuth request is too large.");
  const headers = Object.fromEntries(req.headers.entries());
  // Raw node:https does not identify the client automatically, unlike fetch.
  // APIs may require a User-Agent before they consider OAuth credentials.
  if (!headers["user-agent"]?.trim()) headers["user-agent"] = "Artemis";
  delete headers.host;
  delete headers["content-length"];
  delete headers.connection;
  delete headers["accept-encoding"];
  return new Promise<Response>((resolve, reject) => {
    const connection = request(
      url,
      {
        method: req.method,
        headers,
        lookup: createOAuthLookup(),
        agent: false,
        signal: req.signal,
      },
      (response) => {
        if (
          (response.statusCode ?? 0) >= 300 &&
          (response.statusCode ?? 0) < 400
        ) {
          response.destroy();
          reject(new Error("OAuth redirects are not permitted."));
          return;
        }
        const outputHeaders = new Headers();
        for (const [key, value] of Object.entries(response.headers)) {
          if (value !== undefined && key !== "set-cookie")
            outputHeaders.set(
              key,
              Array.isArray(value) ? value.join(", ") : value,
            );
        }
        let bytes = 0;
        const stream = (
          Readable.toWeb(response) as ReadableStream<Uint8Array>
        ).pipeThrough(
          new TransformStream<Uint8Array, Uint8Array>({
            transform(chunk, controller) {
              bytes += chunk.byteLength;
              if (bytes > 32 * 1024 * 1024) {
                response.destroy();
                throw new Error("OAuth response is too large.");
              }
              controller.enqueue(chunk);
            },
          }),
        );
        const status = response.statusCode ?? 500;
        resolve(
          new Response(
            [204, 205, 304].includes(status) || req.method === "HEAD"
              ? null
              : stream,
            { status, headers: outputHeaders },
          ),
        );
      },
    );
    connection.setTimeout(30000, () =>
      connection.destroy(new Error("OAuth network request timed out.")),
    );
    connection.on("error", reject);
    connection.end(body);
  });
};
