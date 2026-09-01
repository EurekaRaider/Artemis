// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";

import { CatalogSearchNotice } from "../src/renderer/ResourceCenter.js";

afterEach(() => cleanup());

describe("Resource Center catalog feedback", () => {
  it("keeps polite status semantics when search changes from loading to empty", async () => {
    const user = userEvent.setup();
    function Example() {
      const [loading, setLoading] = useState(true);
      return (
        <>
          <CatalogSearchNotice loading={loading}>
            {loading ? "Searching the catalog…" : "No matching servers found."}
          </CatalogSearchNotice>
          <button onClick={() => setLoading(false)} type="button">
            Complete search
          </button>
        </>
      );
    }

    render(<Example />);
    const loadingStatus = screen.getByRole("status");
    expect(loadingStatus.getAttribute("aria-live")).toBe("polite");
    expect(loadingStatus.getAttribute("aria-atomic")).toBe("true");
    expect(loadingStatus.textContent).toContain("Searching the catalog");

    await user.click(screen.getByRole("button", { name: "Complete search" }));
    const emptyStatus = screen.getByRole("status");
    expect(emptyStatus.getAttribute("aria-live")).toBe("polite");
    expect(emptyStatus.getAttribute("aria-atomic")).toBe("true");
    expect(emptyStatus.textContent).toContain("No matching servers found");
  });
});
