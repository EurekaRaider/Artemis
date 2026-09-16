// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { useState } from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import {
  ImGroupPathTree,
  type GroupPathSelection,
} from "../src/renderer/ImGroupPathTree.js";
import { stubWindowArtemis } from "./renderer-test-utils.js";
afterEach(cleanup);
const root = [
  { path: "src", directory: true, protected: false },
  { path: "README.md", directory: false, protected: false },
  { path: ".env", directory: false, protected: true },
];
function Harness({ projectId = "p" }: { projectId?: string }) {
  const [value, setValue] = useState<GroupPathSelection>({
    readPaths: [],
    writePaths: [],
    filePaths: [],
  });
  return (
    <>
      <ImGroupPathTree
        projectId={projectId}
        value={value}
        onChange={setValue}
        disabled={false}
        t={(cn) => cn}
      />
      <output>{JSON.stringify(value)}</output>
    </>
  );
}
it("supports directory batches, individual exclusions, partial selection and safe clearing", async () => {
  const user = userEvent.setup();
  stubWindowArtemis({
    manageIm: vi.fn(async (action) =>
      action.action === "scope-entries" && action.path === "src"
        ? ["a.ts", "b.ts"].map((name) => ({
            path: `src/${name}`,
            directory: false,
            protected: false,
          }))
        : root,
    ),
  });
  render(<Harness />);
  const source = await screen.findByRole("checkbox", { name: "读取/分享 src" });
  expect(source).not.toBeChecked();
  await user.click(screen.getByRole("button", { name: "全选修改" }));
  expect(source).toBeChecked();
  expect(
    screen.queryByRole("checkbox", { name: /\.env/ }),
  ).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "展开 src" }));
  await user.click(
    await screen.findByRole("checkbox", { name: "读取/分享 src/a.ts" }),
  );
  expect(source).toBePartiallyChecked();
  expect(
    screen.getByRole("checkbox", { name: "修改 src/a.ts" }),
  ).not.toBeChecked();
  expect(screen.getByRole("checkbox", { name: "修改 src/b.ts" })).toBeChecked();
  expect(JSON.parse(screen.getByRole("status").textContent!)).toEqual({
    readPaths: ["src/b.ts", "README.md"],
    writePaths: ["src/b.ts", "README.md"],
    filePaths: ["src/b.ts", "README.md"],
  });
  await user.click(screen.getByRole("button", { name: "清空全部" }));
  expect(source).not.toBeChecked();
  expect(JSON.parse(screen.getByRole("status").textContent!).readPaths).toEqual(
    [],
  );
  await user.click(screen.getByRole("checkbox", { name: "修改 src/a.ts" }));
  expect(
    screen.getByRole("checkbox", { name: "读取/分享 src/a.ts" }),
  ).toBeChecked();
});
it("reports directory failures and retries without granting any path", async () => {
  const user = userEvent.setup();
  const manageIm = vi
    .fn()
    .mockRejectedValueOnce(new Error("Unavailable"))
    .mockResolvedValue(root);
  stubWindowArtemis({ manageIm });
  render(<Harness />);
  await user.click(await screen.findByRole("button", { name: "重试" }));
  await waitFor(() =>
    expect(
      screen.getByRole("checkbox", { name: "读取/分享 src" }),
    ).toBeEnabled(),
  );
  expect(
    screen.getByRole("checkbox", { name: "读取/分享 src" }),
  ).not.toBeChecked();
});
