// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { ProviderLogin } from "../../../src/renderer/settings/ProviderLogin.js";
import { stubWindowArtemis } from "../../fixtures/renderer-test-utils.js";

it.each(["en", "zh-CN"] as const)(
  "keeps same-named provider login routes distinct in %s and starts only the selected route",
  async (locale) => {
    const start = vi.fn(async (providerId: string) => ({
      id: "fixture-login",
      providerId,
      status: "completed",
      messages: [],
      links: [],
    }));
    stubWindowArtemis({
      providerLoginOptions: async () => [
        {
          providerId: "cloudflare-ai-gateway",
          name: "Cloudflare API key",
          type: "api_key",
        },
        {
          providerId: "cloudflare-workers-ai",
          name: "Cloudflare API key",
          type: "api_key",
        },
        { providerId: "fixture", name: "Fixture login", type: "api_key" },
        { providerId: "fixture", name: "Fixture login", type: "oauth" },
      ],
      providerLoginStart: start,
      providerLoginCancel: vi.fn(async () => {}),
    });
    render(
      <ProviderLogin
        locale={locale}
        disabled={false}
        onComplete={vi.fn(async () => {})}
      />,
    );
    const login = await screen.findByRole("button", {
      name: locale === "en" ? "Sign in" : "登录",
    });
    await waitFor(() => expect(login).toBeEnabled());
    expect(start).not.toHaveBeenCalled();
    const title =
      locale === "en" ? /Model provider authorization/ : /模型供应商授权/;
    fireEvent.click(screen.getByRole("button", { name: title }));
    const options = screen.getAllByRole("option");
    expect(options).toHaveLength(4);
    expect(new Set(options.map((option) => option.textContent)).size).toBe(4);
    fireEvent.click(
      screen.getByRole("option", { name: /cloudflare-workers-ai/ }),
    );
    fireEvent.click(login);
    await waitFor(() =>
      expect(start).toHaveBeenCalledWith("cloudflare-workers-ai", "api_key"),
    );
    fireEvent.click(screen.getByRole("button", { name: title }));
    fireEvent.click(screen.getByRole("option", { name: /fixture.*OAuth/ }));
    fireEvent.click(login);
    await waitFor(() =>
      expect(start).toHaveBeenLastCalledWith("fixture", "oauth"),
    );
  },
);
