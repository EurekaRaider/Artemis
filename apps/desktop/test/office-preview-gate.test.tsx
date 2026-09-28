// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { OfficePreviewGate } from "../src/renderer/OfficePreviewGate.js";
import { stubWindowArtemis } from "./renderer-test-utils.js";

describe("Office upgrade guidance", () => {
  it.each(["docx", "pptx", "xlsx", "csv"])(
    "gates %s and opens the file after installation",
    async (extension) => {
      let active = false;
      const install = vi.fn(async () => {
        active = true;
      });
      stubWindowArtemis({
        officeCapabilityStatus: async () => ({
          phase: "idle",
          versions: active
            ? [{ version: "1.0.0", active: true, bytes: 10 }]
            : [],
          activeVersion: active ? "1.0.0" : undefined,
          availableVersion: "1.0.0",
        }),
        installOfficeCapability: install,
      });
      render(
        <OfficePreviewGate locale="zh-CN">
          <div>File.{extension}</div>
        </OfficePreviewGate>,
      );
      expect(
        await screen.findByText("不支持预览，如需预览请升级office功能"),
      ).toBeInTheDocument();
      expect(screen.queryByText(`File.${extension}`)).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "升级 Office 功能" }));
      expect(
        await screen.findByRole("button", { name: "导入离线包" }),
      ).toBeInTheDocument();
      fireEvent.click(await screen.findByRole("button", { name: "在线安装" }));
      await waitFor(() => expect(install).toHaveBeenCalledOnce());
      expect(await screen.findByText(`File.${extension}`)).toBeInTheDocument();
    },
  );
  it("does not treat a failed status check as ready", async () => {
    stubWindowArtemis({
      officeCapabilityStatus: async () => {
        throw new Error("Status unavailable");
      },
    });
    render(
      <OfficePreviewGate locale="en">
        <div>Editor</div>
      </OfficePreviewGate>,
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Status unavailable",
    );
    expect(screen.queryByText("Editor")).not.toBeInTheDocument();
  });
  it("requires activation of an installed component", async () => {
    stubWindowArtemis({
      officeCapabilityStatus: async () => ({
        phase: "idle",
        versions: [{ version: "1.0.0", active: false, bytes: 10 }],
      }),
    });
    render(
      <OfficePreviewGate locale="en">
        <div>Editor</div>
      </OfficePreviewGate>,
    );
    expect(
      await screen.findByText(
        "Preview is unavailable. Upgrade Office features to preview this file.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText("Editor")).not.toBeInTheDocument();
  });
});
