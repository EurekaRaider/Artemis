import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import { ArtemisAgentHost } from "../src/runtime.js";
import { runNativeWebSearch } from "../src/web-search.js";

function searchHtml(
  results: Array<{ title: string; url: string; snippet?: string }>,
): string {
  return results
    .map(
      (result) => `
        <div class="result results_links web-result">
          <a class="result__a" href="//duckduckgo.com/l/?uddg=${encodeURIComponent(result.url)}&amp;rut=test">
            ${result.title}
          </a>
          ${
            result.snippet
              ? `<a class="result__snippet" href="#">${result.snippet}</a>`
              : ""
          }
        </div>`,
    )
    .join("\n");
}

function htmlResponse(
  html: string,
  headers?: Record<string, string>,
): Response {
  return new Response(html, {
    status: 200,
    headers: { "content-type": "text/html; charset=UTF-8", ...headers },
  });
}

describe("native web search", () => {
  it("registers web_search in both read-only and Execute toolsets", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "artemis-web-search-"));
    const brokerRequest = vi.fn(async () => {
      throw new Error("Anonymous web search must not use the approval broker.");
    });
    const emit = vi.fn();
    const host = new ArtemisAgentHost({ request: brokerRequest }, { emit });
    try {
      await host.openThread({
        threadId: "web-search-thread",
        workspacePath: workspace,
        target: "local",
      });
      const thread = (
        host as unknown as {
          threads: Map<
            string,
            {
              delegatedTools: Array<{
                name: string;
                parameters: {
                  properties?: Record<string, unknown>;
                  additionalProperties?: boolean;
                };
                execute(
                  toolCallId: string,
                  parameters: Record<string, unknown>,
                ): Promise<{
                  content: Array<{ type: string; text: string }>;
                  details?: Record<string, unknown>;
                }>;
              }>;
              executeTools: Array<{ name: string }>;
              currentTurnId?: string;
            }
          >;
        }
      ).threads.get("web-search-thread");
      const delegated = thread?.delegatedTools.find(
        (tool) => tool.name === "web_search",
      );

      expect(delegated).toBeDefined();
      expect(delegated?.parameters.properties).toHaveProperty("query");
      expect(delegated?.parameters.properties).toHaveProperty(
        "allowed_domains",
      );
      expect(delegated?.parameters.additionalProperties).toBe(false);
      expect(thread?.executeTools.map((tool) => tool.name)).toContain(
        "web_search",
      );
      if (thread) thread.currentTurnId = "turn-1";

      vi.stubGlobal(
        "fetch",
        vi.fn(async () =>
          htmlResponse(
            searchHtml([
              {
                title: "Anonymous result",
                url: "https://example.org/anonymous",
              },
            ]),
          ),
        ),
      );
      await expect(
        delegated?.execute("web-search-call", { query: "anonymous search" }),
      ).resolves.toMatchObject({
        details: {
          engine: "DuckDuckGo HTML",
          resultCount: 1,
        },
      });
      expect(emit).toHaveBeenCalledWith(
        "web-search-thread",
        "turn-1",
        expect.objectContaining({
          type: "task.source.added",
          kind: "web-search",
          query: "anonymous search",
          resultCount: 1,
          links: [
            {
              title: "Anonymous result",
              url: "https://example.org/anonymous",
            },
          ],
        }),
      );
      expect(brokerRequest).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
      host.dispose();
      await rm(workspace, { recursive: true, force: true });
    }
  });

  it("searches a fixed HTTPS endpoint without credentials and returns direct links", async () => {
    const fetchSearch = vi.fn(
      async (_input: string | URL | Request, _init?: RequestInit) =>
        htmlResponse(
          searchHtml([
            {
              title: "Example &amp; documentation",
              url: "https://example.org/docs?version=current",
              snippet: "Read the <b>current</b> documentation.",
            },
          ]),
        ),
    );

    const result = await runNativeWebSearch(
      { query: "  Artemis web search  " },
      undefined,
      { fetch: fetchSearch as typeof globalThis.fetch },
    );

    expect(fetchSearch).toHaveBeenCalledOnce();
    const [input, init] = fetchSearch.mock.calls[0] ?? [];
    const url = new URL(String(input));
    expect(url.origin).toBe("https://html.duckduckgo.com");
    expect(url.pathname).toBe("/html/");
    expect(url.searchParams.get("q")).toBe("Artemis web search");
    expect(url.searchParams.get("kp")).toBe("1");
    const headers = new Headers(init?.headers);
    expect(headers.get("authorization")).toBeNull();
    expect(headers.get("cookie")).toBeNull();
    expect(init).toMatchObject({
      method: "GET",
      credentials: "omit",
      redirect: "error",
      referrerPolicy: "no-referrer",
    });
    expect(result.engine).toBe("DuckDuckGo HTML");
    expect(result.resultCount).toBe(1);
    expect(result.sources).toEqual([
      {
        title: "Example & documentation",
        url: "https://example.org/docs?version=current",
      },
    ]);
    expect(result.text).toContain("Example & documentation");
    expect(result.text).toContain("https://example.org/docs?version=current");
    expect(result.text).toContain("Read the current documentation.");
  });

  it("applies and enforces an allowed-domain boundary", async () => {
    const fetchSearch = vi.fn(async () =>
      htmlResponse(
        searchHtml([
          {
            title: "Allowed",
            url: "https://docs.example.org/current",
            snippet: "An allowed result.",
          },
          {
            title: "Filtered",
            url: "https://unrelated.test/result",
            snippet: "This result must not escape the domain boundary.",
          },
        ]),
      ),
    );

    const result = await runNativeWebSearch(
      {
        query: "current docs",
        allowedDomains: ["Example.ORG", "example.org"],
      },
      undefined,
      { fetch: fetchSearch as typeof globalThis.fetch },
    );

    const [input] = fetchSearch.mock.calls[0] ?? [];
    expect(new URL(String(input)).searchParams.get("q")).toBe(
      "current docs (site:example.org)",
    );
    expect(result.resultCount).toBe(1);
    expect(result.text).toContain("https://docs.example.org/current");
    expect(result.text).not.toContain("unrelated.test");
  });

  it("returns an explicit empty result for a recognized no-results page", async () => {
    const result = await runNativeWebSearch(
      { query: "nothing here" },
      undefined,
      {
        fetch: vi.fn(async () =>
          htmlResponse('<div class="no-results">No results.</div>'),
        ) as typeof globalThis.fetch,
      },
    );

    expect(result.resultCount).toBe(0);
    expect(result.sources).toEqual([]);
    expect(result.text).toContain("No web results were found");
    expect(result.text).toContain("DuckDuckGo HTML");
  });

  it("bounds structured source metadata before it reaches persisted events", async () => {
    const result = await runNativeWebSearch(
      { query: "bounded source" },
      undefined,
      {
        fetch: vi.fn(async () =>
          htmlResponse(
            searchHtml([
              {
                title: "T".repeat(600),
                url: "https://example.org/bounded",
              },
              {
                title: "Oversized URL",
                url: `https://example.org/${"x".repeat(4_100)}`,
              },
            ]),
          ),
        ) as typeof globalThis.fetch,
      },
    );

    expect(result.resultCount).toBe(1);
    expect(result.sources).toEqual([
      { title: "T".repeat(500), url: "https://example.org/bounded" },
    ]);
  });

  it("reports an anti-bot challenge instead of treating it as results", async () => {
    await expect(
      runNativeWebSearch({ query: "challenge" }, undefined, {
        fetch: vi.fn(async () =>
          htmlResponse('<form id="challenge-form">Bots use DuckDuckGo</form>'),
        ) as typeof globalThis.fetch,
      }),
    ).rejects.toThrow("anti-bot challenge");
  });

  it("rejects failed, oversized, and unrecognized responses", async () => {
    await expect(
      runNativeWebSearch({ query: "failed" }, undefined, {
        fetch: vi.fn(
          async () => new Response("Unavailable", { status: 503 }),
        ) as typeof globalThis.fetch,
      }),
    ).rejects.toThrow("HTTP 503");

    await expect(
      runNativeWebSearch({ query: "oversized" }, undefined, {
        fetch: vi.fn(async () =>
          htmlResponse("small", { "content-length": String(3 * 1024 * 1024) }),
        ) as typeof globalThis.fetch,
      }),
    ).rejects.toThrow("exceeded 2 MiB");

    await expect(
      runNativeWebSearch({ query: "changed markup" }, undefined, {
        fetch: vi.fn(async () =>
          htmlResponse("<html>unexpected</html>"),
        ) as typeof globalThis.fetch,
      }),
    ).rejects.toThrow("unrecognized response");
  });

  it("rejects an empty query before making a network request", async () => {
    const fetchSearch = vi.fn();
    await expect(
      runNativeWebSearch({ query: "   " }, undefined, {
        fetch: fetchSearch as typeof globalThis.fetch,
      }),
    ).rejects.toThrow("must not be empty");
    expect(fetchSearch).not.toHaveBeenCalled();
  });

  it("rejects malformed allowed domains before making a network request", async () => {
    const fetchSearch = vi.fn();
    await expect(
      runNativeWebSearch(
        { query: "domain boundary", allowedDomains: ["https://example.org"] },
        undefined,
        { fetch: fetchSearch as typeof globalThis.fetch },
      ),
    ).rejects.toThrow("must be a bare hostname");
    expect(fetchSearch).not.toHaveBeenCalled();
  });
});
