import { describe, expect, it } from "vitest";
import {
  validateConnectorDefinition,
  assertConnectorTransport,
} from "../src/shared/connectors.js";

const gmail = {
  version: 1,
  id: "gmail",
  provider: "google",
  auth: "oauth-pkce",
  displayName: "Gmail",
  scopes: [
    "openid",
    "email",
    "profile",
    "https://www.googleapis.com/auth/gmail.modify",
  ],
};

describe("connector authorization boundary", () => {
  it("rejects undeclared versions, providers, scopes and credential injection", () => {
    for (const change of [
      { version: 0 },
      { provider: "untrusted" },
      { scopes: ["https://evil.example/read"] },
      { accessToken: "secret" },
      { clientSecret: "secret" },
      { auth: "none" },
    ]) {
      expect(() =>
        validateConnectorDefinition({ ...gmail, ...change }),
      ).toThrow();
    }
  });
  it("does not send host credentials to a remote Google adapter", () => {
    expect(() =>
      assertConnectorTransport(
        validateConnectorDefinition(gmail),
        "streamable-http",
        "https://evil.example/mcp",
      ),
    ).toThrow();
  });
  it("binds GitHub credentials to the official resource", () => {
    const definition = validateConnectorDefinition({
      version: 1,
      id: "github",
      provider: "github",
      auth: "device-code",
      displayName: "GitHub",
      scopes: ["read:user", "repo"],
    });
    expect(() =>
      assertConnectorTransport(
        definition,
        "streamable-http",
        "https://api.githubcopilot.com/mcp/",
      ),
    ).not.toThrow();
    for (const url of [
      "https://evil.example/mcp/",
      "https://api.githubcopilot.com.evil.example/mcp/",
      "http://api.githubcopilot.com/mcp/",
    ]) {
      expect(() =>
        assertConnectorTransport(definition, "streamable-http", url),
      ).toThrow();
    }
  });
  it("only accepts the Figma desktop loopback endpoint", () => {
    const definition = validateConnectorDefinition({
      version: 1,
      id: "figma",
      provider: "figma",
      auth: "none",
      displayName: "Figma",
      scopes: [],
    });
    expect(() =>
      assertConnectorTransport(
        definition,
        "streamable-http",
        "http://127.0.0.1:3845/mcp",
      ),
    ).not.toThrow();
    expect(() =>
      assertConnectorTransport(
        definition,
        "streamable-http",
        "http://192.168.1.1:3845/mcp",
      ),
    ).toThrow();
  });
});
