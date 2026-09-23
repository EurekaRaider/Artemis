import { describe, expect, it } from "vitest";
import {
  isPublicOAuthAddress,
  createOAuthLookup,
} from "../src/main/connector-oauth-network.js";
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

it("checks browser destinations before opening authorization", async () => {
  const { assertPublicOAuthBrowserUrl } =
    await import("../src/main/connector-oauth-network.js");
  await expect(
    assertPublicOAuthBrowserUrl(
      "https://auth.example.com/authorize?state=public-state",
      async () => [{ address: "127.0.0.1", family: 4 }],
    ),
  ).rejects.toThrow(/public network/);
  await expect(
    assertPublicOAuthBrowserUrl(
      "https://auth.example.com/authorize?state=public-state",
      async () => [{ address: "93.184.216.34", family: 4 }],
    ),
  ).resolves.toBeUndefined();
});
