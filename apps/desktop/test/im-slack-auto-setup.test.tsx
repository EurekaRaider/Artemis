// @vitest-environment jsdom
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ImSlackAutoSetup } from "../src/renderer/ImSlackAutoSetup.js";
import { uiTranslator } from "../src/shared/ui-text.js";
import { stubWindowArtemis } from "./renderer-test-utils.js";
import {
  APP_LOCALES,
  type ImManagement,
  type ImSlackSetupStatus,
} from "@artemis/protocol";

const t = uiTranslator("zh-CN"),
  id = "726d9206-e855-454c-8322-a04ce9bfb222";
const command = "/slackauthticket YXV0aG9yaXphdGlvbi10ZXN0";
afterEach(() => vi.useRealTimers());
function fixture(initial: ImSlackSetupStatus = { state: "idle" }) {
  let status = initial;
  const manage = vi.fn(async (action: ImManagement) => {
    if (action.action === "slack-setup-start")
      status = {
        state: "awaiting-code",
        sessionId: id,
        authorizationCommand: command,
        expiresAt: Date.now() + 600000,
      };
    if (action.action === "slack-setup-submit")
      status = {
        state: "connected",
        sessionId: id,
        connectionId: "slack-test",
      };
    if (action.action === "slack-setup-cancel")
      status = { state: "cancelled", sessionId: id };
    return status;
  });
  stubWindowArtemis({
    getSnapshot: vi.fn(async () => ({ userName: "Tester" }) as never),
    manageIm: manage,
  });
  const onConnected = vi.fn();
  return { manage, onConnected };
}
it.each(APP_LOCALES)(
  "has an editable automatic setup entry without manual creation in %s",
  async (locale) => {
    const f = fixture();
    render(
      <ImSlackAutoSetup
        t={uiTranslator(locale)}
        busy={false}
        disabled={false}
        onConnected={f.onConnected}
      />,
    );
    expect(
      screen.getByRole("button", {
        name: uiTranslator(locale)("ImSlackAutoSetup.start"),
      }),
    ).toBeVisible();
    expect(await screen.findByDisplayValue("Tester_bot")).toBeEnabled();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  },
);
it("submits only the confirmation code and continues existing pairing with the connection ID", async () => {
  const f = fixture();
  render(
    <ImSlackAutoSetup
      t={t}
      busy={false}
      disabled={false}
      onConnected={f.onConnected}
    />,
  );
  await waitFor(() =>
    expect(f.manage).toHaveBeenCalledWith({ action: "slack-setup-status" }),
  );
  fireEvent.click(
    screen.getByRole("button", { name: t("ImSlackAutoSetup.start") }),
  );
  expect(await screen.findByDisplayValue(command)).toHaveAttribute("readonly");
  fireEvent.change(screen.getByLabelText(t("ImSlackAutoSetup.code")), {
    target: { value: "ABC123xy" },
  });
  fireEvent.click(
    screen.getByRole("button", { name: t("ImSlackAutoSetup.submit") }),
  );
  await waitFor(() =>
    expect(f.onConnected).toHaveBeenCalledExactlyOnceWith("slack-test"),
  );
  expect(f.manage).toHaveBeenCalledWith({
    action: "slack-setup-submit",
    sessionId: id,
    challenge: "ABC123xy",
  });
  expect(screen.queryByDisplayValue("ABC123xy")).not.toBeInTheDocument();
});
it("cancels without accepting a stale status poll", async () => {
  vi.useFakeTimers();
  const f = fixture({ state: "configuring", sessionId: id });
  render(
    <ImSlackAutoSetup
      t={t}
      busy={false}
      disabled={false}
      onConnected={f.onConnected}
    />,
  );
  await act(async () => undefined);
  expect(screen.getByText(t("ImSlackAutoSetup.configuring"))).toBeVisible();
  let resolvePoll!: (value: any) => void;
  f.manage.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        resolvePoll = resolve;
      }),
  );
  await act(() => vi.advanceTimersByTimeAsync(1000));
  fireEvent.click(
    screen.getByRole("button", { name: t("ImSlackAutoSetup.cancel") }),
  );
  await act(async () => {
    resolvePoll({ state: "connected", sessionId: id, connectionId: "stale" });
  });
  expect(f.onConnected).not.toHaveBeenCalled();
  expect(
    screen.getByRole("button", { name: t("ImSlackAutoSetup.start") }),
  ).toBeVisible();
  expect(
    screen.queryByText(t("ImSlackAutoSetup.cancelled")),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByLabelText(t("ImSlackAutoSetup.code")),
  ).not.toBeInTheDocument();
});
it("shows administrator approval and resumes the original setup", async () => {
  const f = fixture({
    state: "approval-required",
    sessionId: id,
    appId: "ATEST",
  });
  render(
    <ImSlackAutoSetup
      t={t}
      busy={false}
      disabled={false}
      onConnected={f.onConnected}
    />,
  );
  await screen.findByText(t("ImSlackAutoSetup.approval"));
  fireEvent.click(
    screen.getByRole("button", { name: t("ImSlackAutoSetup.retry") }),
  );
  await waitFor(() =>
    expect(f.manage).toHaveBeenCalledWith({
      action: "slack-setup-start",
      name: "Tester_bot",
      sessionId: id,
    }),
  );
});
it("uses the exact editable bot name for automatic setup", async () => {
  const f = fixture();
  render(
    <ImSlackAutoSetup
      t={t}
      busy={false}
      disabled={false}
      onConnected={f.onConnected}
    />,
  );
  const name = await screen.findByLabelText("机器人名称");
  fireEvent.change(name, { target: { value: "  Aurora  " } });
  fireEvent.click(
    screen.getByRole("button", { name: t("ImSlackAutoSetup.start") }),
  );
  await waitFor(() =>
    expect(f.manage).toHaveBeenCalledWith({
      action: "slack-setup-start",
      name: "Aurora",
    }),
  );
});
it("restores a cancelled setup as the editable initial form", async () => {
  const f = fixture({
    state: "cancelled",
    sessionId: id,
    name: "Saved bot",
    appId: "ATEST",
  } as ImSlackSetupStatus);
  render(
    <ImSlackAutoSetup
      t={t}
      busy={false}
      disabled={false}
      onConnected={f.onConnected}
    />,
  );
  expect(await screen.findByDisplayValue("Saved bot")).toBeEnabled();
  fireEvent.change(screen.getByLabelText("机器人名称"), {
    target: { value: " " },
  });
  expect(
    screen.getByRole("button", { name: t("ImSlackAutoSetup.start") }),
  ).toBeDisabled();
  expect(
    screen.queryByText(t("ImSlackAutoSetup.cancelled")),
  ).not.toBeInTheDocument();
});
it("blocks duplicate bot names until the user chooses another name", async () => {
  const f = fixture();
  render(
    <ImSlackAutoSetup
      t={t}
      busy={false}
      disabled={false}
      connections={[{ id: "existing", name: "Aurora" }]}
      onConnected={f.onConnected}
    />,
  );
  await screen.findByDisplayValue("Tester_bot");
  const name = screen.getByLabelText("机器人名称");
  fireEvent.change(name, { target: { value: "  AURORA  " } });
  expect(name).toHaveAttribute("aria-invalid", "true");
  expect(
    screen.getByText("已有同名机器人，请换个名字，避免重复创建。"),
  ).toBeVisible();
  const start = screen.getByRole("button", {
    name: t("ImSlackAutoSetup.start"),
  });
  expect(start).toBeDisabled();
  fireEvent.click(start);
  expect(f.manage).not.toHaveBeenCalledWith(
    expect.objectContaining({ action: "slack-setup-start" }),
  );
  fireEvent.change(name, { target: { value: "Aurora 2" } });
  expect(name).not.toHaveAttribute("aria-invalid", "true");
  expect(start).toBeEnabled();
});
it("shows a backend name conflict next to the name and allows correction", async () => {
  const f = fixture({
    state: "error",
    sessionId: id,
    name: "Aurora",
    error: "name-taken",
  });
  render(
    <ImSlackAutoSetup
      t={t}
      busy={false}
      disabled={false}
      onConnected={f.onConnected}
    />,
  );
  const name = await screen.findByDisplayValue("Aurora");
  expect(name).toHaveAttribute("aria-invalid", "true");
  expect(
    screen.getByRole("button", { name: t("ImSlackAutoSetup.retry") }),
  ).toBeDisabled();
  fireEvent.change(name, { target: { value: "Aurora 2" } });
  expect(
    screen.getByRole("button", { name: t("ImSlackAutoSetup.retry") }),
  ).toBeEnabled();
});
it("allows resuming the same connection without reporting a duplicate", async () => {
  const f = fixture({
    state: "interrupted",
    sessionId: id,
    connectionId: "same",
    appId: "ATEST",
    name: "Aurora",
  });
  render(
    <ImSlackAutoSetup
      t={t}
      busy={false}
      disabled={false}
      connections={[{ id: "same", name: "Aurora" }]}
      onConnected={f.onConnected}
    />,
  );
  const name = await screen.findByDisplayValue("Aurora");
  expect(name).not.toHaveAttribute("aria-invalid", "true");
  expect(
    screen.getByRole("button", { name: t("ImSlackAutoSetup.retry") }),
  ).toBeEnabled();
});
it("does not render sensitive or arbitrary IPC error output", async () => {
  const f = fixture();
  f.manage.mockRejectedValue(new Error("xoxb-do-not-render-token"));
  render(
    <ImSlackAutoSetup
      t={t}
      busy={false}
      disabled={false}
      onConnected={f.onConnected}
    />,
  );
  expect(await screen.findByRole("alert")).toHaveTextContent(
    t("ImSlackAutoSetup.failed"),
  );
  expect(document.body.textContent).not.toContain("xoxb-do-not-render-token");
});
