import { describe, expect, it } from "vitest";

import { galleryContract } from "../src/gallery-contract.js";

describe("UI Gallery public package contract", () => {
  it("consumes the public UI and Artemis theme exports", () => {
    expect(galleryContract).toEqual(
      expect.objectContaining({
        uiContractVersion: 1,
        themeVersion: "1.4.41",
        skinId: "com.artemis.default",
      }),
    );
    expect(galleryContract.modes).toEqual(["light", "dark"]);
    expect(galleryContract.contrastModes).toEqual(["normal", "high"]);
  });
});
