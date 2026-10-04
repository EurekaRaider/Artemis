import { describe, expect, it } from "vitest";
import {
  isPublicOAuthAddress,
  createOAuthLookup,
} from "../../../src/main/connectors/connector-oauth-network.js";
describe("OAuth connection-time DNS policy", () => {
  it("rejects private, loopback, reserved, mapped and transition addresses", () => {
    for (const ip of [
      "127.0.0.1",
      "10.1.2.3",
      "172.16.0.2",
      "192.168.1.2",
      "169.254.169.254",
      "100.64.0.1",
      "0.0.0.0",
      "224.0.0.1",
      "::1",
      "::ffff:127.0.0.1",
      "fe80::1",
      "fc00::1",
      "2001:db8::1",
      "2002:7f00:1::1",
    ])
      expect(isPublicOAuthAddress(ip), ip).toBe(false);
    expect(isPublicOAuthAddress("8.8.8.8")).toBe(true);
    expect(isPublicOAuthAddress("2606:4700:4700::1111")).toBe(true);
  });
  it("rejects mixed DNS answers at the lookup used by the socket", async () => {
    const lookup = createOAuthLookup(async () => [
      { address: "8.8.8.8", family: 4 },
      { address: "127.0.0.1", family: 4 },
    ]);
    await expect(
      new Promise((resolve, reject) =>
        lookup("auth.example.com", {}, (err, address) =>
          err ? reject(err) : resolve(address),
        ),
      ),
    ).rejects.toThrow(/public/);
  });
  it("pins the approved address in the actual connection lookup", async () => {
    let queries = 0;
    const lookup = createOAuthLookup(async () => {
      queries++;
      return [{ address: "8.8.8.8", family: 4 }];
    });
    expect(
      await new Promise((resolve, reject) =>
        lookup("auth.example.com", {}, (err, address) =>
          err ? reject(err) : resolve(address),
        ),
      ),
    ).toBe("8.8.8.8");
    expect(queries).toBe(1);
  });
});

it("lets the browser resolve public hostnames but rejects literal local targets", async () => {
  const { assertPublicOAuthBrowserUrl } =
    await import("../../../src/main/connectors/connector-oauth-network.js");
  await expect(
    assertPublicOAuthBrowserUrl(
      "https://auth.example.com/authorize?state=public-state",
    ),
  ).resolves.toBeUndefined();
  for (const url of [
    "https://127.0.0.1/authorize",
    "http://auth.example.com/",
    "https://localhost/",
    "https://user:pass@auth.example.com/",
  ])
    await expect(assertPublicOAuthBrowserUrl(url)).rejects.toThrow();
});

it("replaces only Fake-IP answers with independently verified public addresses", async () => {
  const { resolveOAuthAddresses } =
    await import("../../../src/main/connectors/connector-oauth-network.js");
  let secureCalls = 0;
  const secure = async () => {
    secureCalls++;
    return [{ address: "8.8.8.8", family: 4 }];
  };
  expect(
    await resolveOAuthAddresses(
      "accounts.example.com",
      async () => [{ address: "198.18.0.81", family: 4 }],
      secure,
    ),
  ).toEqual([{ address: "8.8.8.8", family: 4 }]);
  expect(secureCalls).toBe(1);
  await expect(
    resolveOAuthAddresses(
      "accounts.example.com",
      async () => [{ address: "127.0.0.1", family: 4 }],
      secure,
    ),
  ).rejects.toThrow(/public/);
  expect(secureCalls).toBe(1);
  await expect(
    resolveOAuthAddresses(
      "accounts.example.com",
      async () => [
        { address: "198.18.0.81", family: 4 },
        { address: "10.0.0.1", family: 4 },
      ],
      secure,
    ),
  ).rejects.toThrow(/public/);
  await expect(
    resolveOAuthAddresses(
      "accounts.example.com",
      async () => [{ address: "198.19.0.81", family: 4 }],
      async () => [{ address: "127.0.0.1", family: 4 }],
    ),
  ).rejects.toThrow(/public/);
  expect(isPublicOAuthAddress("198.18.0.81")).toBe(false);
});

it("pins the real address after Fake-IP resolution without retrying the virtual address", async () => {
  const { resolveOAuthAddresses } =
    await import("../../../src/main/connectors/connector-oauth-network.js");
  let systemCalls = 0;
  const lookup = createOAuthLookup((host) =>
    resolveOAuthAddresses(
      host,
      async () => {
        systemCalls++;
        return [{ address: "198.18.0.1", family: 4 }];
      },
      async () => [{ address: "8.8.4.4", family: 4 }],
    ),
  );
  expect(
    await new Promise((resolve, reject) =>
      lookup("auth.example.com", {}, (error, address) =>
        error ? reject(error) : resolve(address),
      ),
    ),
  ).toBe("8.8.4.4");
  expect(systemCalls).toBe(1);
  await expect(
    resolveOAuthAddresses(
      "auth.example.com",
      async () => [{ address: "198.18.0.1", family: 4 }],
      async () => {
        throw new Error("Secure DNS unavailable");
      },
    ),
  ).rejects.toThrow("Secure DNS unavailable");
});

it("handles a TUN Fake-IP answer mixed with genuine public IPv6, but never private IPv6", async () => {
  const { resolveOAuthAddresses } =
    await import("../../../src/main/connectors/connector-oauth-network.js");
  const secure = async () => [{ address: "8.8.8.8", family: 4 }];
  expect(
    await resolveOAuthAddresses(
      "auth.example.com",
      async () => [
        { address: "198.18.1.1", family: 4 },
        { address: "2606:4700:4700::1111", family: 6 },
      ],
      secure,
    ),
  ).toEqual(await secure());
  await expect(
    resolveOAuthAddresses(
      "auth.example.com",
      async () => [
        { address: "198.18.1.1", family: 4 },
        { address: "::1", family: 6 },
      ],
      secure,
    ),
  ).rejects.toThrow(/public/);
});
