import { describe, expect, it } from "vitest";
import {
  validateConnectorDefinition,
  assertConnectorTransport,
} from "../src/shared/connectors.js";
import { connectorBinding } from "../src/main/connector-service.js";
import { futureConnector } from "./fixtures/connector-oauth.js";
import type { McpServerConfig } from "../src/shared/api.js";
const validate = (oauth: object) =>
  validateConnectorDefinition({ ...futureConnector, oauth });
describe("declarative public OAuth boundary", () => {
  it("accepts a platform, permission and issuer unknown to the host", () => {
    expect(validateConnectorDefinition(futureConnector)).toMatchObject(
      futureConnector,
    );
  });
  it("rejects secrets, executable fields and overriding transaction parameters", () => {
    for (const change of [
      { clientSecret: "secret" },
      { script: "steal()" },
      { authorizationParameters: { state: "injected" } },
      { authorizationParameters: { client_secret: "injected" } },
      { authorizationParameters: { redirect_uri: "https://evil.example" } },
    ])
      expect(() => validate({ ...futureConnector.oauth, ...change })).toThrow();
  });
  it("rejects insecure OAuth endpoints and remote callbacks", () => {
    for (const tokenEndpoint of [
      "http://api.example.com/token",
      "https://127.0.0.1/token",
      "https://user:pass@api.example.com/token",
      "https://api.example.com/token#fragment",
    ]) {
      expect(() =>
        validate({ ...futureConnector.oauth, tokenEndpoint }),
      ).toThrow();
    }
    expect(() =>
      validate({
        ...futureConnector.oauth,
        redirect: { hostname: "evil.example" },
      }),
    ).toThrow();
  });
  it("does not allow an unrelated remote MCP to receive the grant", () => {
    const d = validate({
      ...futureConnector.oauth,
      mcpEndpoint: "https://api.example.com/mcp",
    });
    expect(() =>
      assertConnectorTransport(
        d,
        "streamable-http",
        "https://evil.example/mcp",
      ),
    ).toThrow();
    expect(() =>
      assertConnectorTransport(
        d,
        "streamable-http",
        "https://api.example.com/mcp",
      ),
    ).not.toThrow();
  });
  it("binds the client and security contract but ignores display-only edits", () => {
    const config = {
      id: "fixture",
      name: "Fixture",
      transport: "stdio",
      command: "node",
      args: [],
      env: {},
      envVars: [],
      workspacePath: "/tmp",
      enabled: false,
      connector: futureConnector,
    } as McpServerConfig;
    expect(
      connectorBinding({
        ...config,
        connector: {
          ...futureConnector,
          displayName: "Translated",
          oauth: { ...futureConnector.oauth!, applicationName: "Translated" },
        },
      }),
    ).toBe(connectorBinding(config));
    expect(
      connectorBinding({
        ...config,
        connector: {
          ...futureConnector,
          oauth: {
            ...futureConnector.oauth!,
            client: { type: "static", clientId: "replacement" },
          },
        },
      }),
    ).not.toBe(connectorBinding(config));
  });
});
