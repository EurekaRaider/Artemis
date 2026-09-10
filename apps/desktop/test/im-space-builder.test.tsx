// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { useState } from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it } from "vitest";
import { ImSpaceBuilder } from "../src/renderer/ImSpaceBuilder.js";

afterEach(cleanup);
it("keeps the form editable when member names are empty or indistinguishable", async () => {
  const user = userEvent.setup();
  const participants = ["alice", "bob"].map((userId) => ({
    deviceId: userId,
    name: "Lark",
    identity: {
      channel: "slack",
      connectionId: "slack",
      tenantId: "t",
      appId: "app",
      userId,
    },
  }));
  const draft = {
    id: "team",
    name: "Team",
    participants,
    endpoints: [{ connectionId: "slack", id: "group", kind: "group" }],
    administrators: [participants[0]!.identity],
  };
  function Editor() {
    const [value, onChange] = useState(JSON.stringify(draft));
    return (
      <ImSpaceBuilder
        value={value}
        onChange={onChange}
        diagnostics={{
          identities: participants,
          groups: [],
          deliveries: [],
          spaces: [],
        }}
        connections={[]}
        busy={false}
        t={(cn) => cn}
      />
    );
  }
  render(<Editor />);
  const name = screen.getByRole("textbox", { name: "成员显示名称 · alice" });
  await user.clear(name);
  expect(name).toHaveValue("");
  const approver = screen.getByRole("button", { name: /^谁来确认群接入/ });
  await user.click(approver);
  expect(screen.getAllByRole("option")).toHaveLength(3);
  await waitFor(() => expect(screen.getByRole("listbox")).toHaveFocus());
  await user.keyboard("{Escape}");
  await waitFor(() => expect(approver).toHaveFocus());
  await user.type(name, " lark ");
  expect(name).toHaveValue(" lark ");
  await user.clear(name);
  await user.type(name, "New member");
  expect(screen.getByRole("textbox", { name: "给这组群起个名字" })).toHaveValue(
    "Team",
  );
});
