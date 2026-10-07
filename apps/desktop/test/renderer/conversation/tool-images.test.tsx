// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { render } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { ToolActivityGroupCard } from "../../../src/renderer/app/App.js";
import type { ToolState } from "@artemis/protocol";

vi.mock(
  "../../../src/renderer/appearance/desktop-skin-bootstrap.js",
  () => ({}),
);

it.each(["read", "codemode", "attachment_read", "mixed"])(
  "shows image output after expanding a %s tool group",
  async (name) => {
    const image = {
      data: "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
      mimeType: "image/gif",
    };
    const tools: ToolState[] = [
      {
        id: "image",
        name: name === "mixed" ? "read" : name,
        input: { path: "picture.gif" },
        output: "Image read",
        status: "completed",
        images: [image],
      },
    ];
    if (name === "mixed")
      tools.push({
        id: "shell",
        name: "shell",
        input: { command: "pwd" },
        output: "workspace",
        status: "completed",
      });
    const { container } = render(
      <ToolActivityGroupCard
        active={false}
        locale="en"
        onFileLink={() => {}}
        tools={tools}
      />,
    );
    const disclosure = container.querySelector<HTMLButtonElement>(
      '[data-part="disclosure"]',
    )!;
    await userEvent.click(disclosure);
    const preview = container.querySelector("img");
    expect(preview).toBeVisible();
    expect(preview).toHaveAttribute(
      "src",
      `data:${image.mimeType};base64,${image.data}`,
    );
    expect(preview?.closest("a")).toHaveAttribute(
      "download",
      "generated-image-0.gif",
    );
  },
);
