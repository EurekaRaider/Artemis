import { expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import { Readable } from "node:stream";
import { request } from "node:https";
import { fetchPublicOAuth } from "../src/main/connector-oauth-network.js";

vi.mock("node:https", () => ({
  request: vi.fn((_url, options, respond) => {
    const connection = new EventEmitter() as EventEmitter & {
      setTimeout: () => void;
      end: () => void;
    };
    connection.setTimeout = () => {};
    connection.end = () => {
      // Model APIs that require a client identifier before checking credentials.
      const response = Object.assign(
        Readable.from([Buffer.from('{"id":"account"}')]),
        {
          statusCode: options.headers["user-agent"]?.trim() ? 200 : 403,
          headers: { "content-type": "application/json" },
        },
      );
      respond(response);
    };
    return connection;
  }),
}));

it("identifies the host on OAuth account requests without provider-specific headers", async () => {
  const response = await fetchPublicOAuth("https://api.example.com/me", {
    headers: {
      Authorization: "Bearer synthetic-test-token",
      Accept: "application/json",
    },
  });
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ id: "account" });
  expect(vi.mocked(request).mock.calls.at(-1)?.[1]).toMatchObject({
    headers: {
      "user-agent": "Artemis",
      authorization: "Bearer synthetic-test-token",
    },
  });
});
