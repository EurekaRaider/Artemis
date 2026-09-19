import { describe, expect, it } from "vitest";
import { imManagementSchema } from "../src/im.js";

describe("IM scan registration region", () => {
  it("accepts either region and keeps legacy requests without a region valid", () => {
    for (const domain of ["feishu", "lark", undefined]) {
      const action = {
        action: "feishu-scan-begin",
        ...(domain ? { domain } : {}),
      };
      expect(imManagementSchema.parse(action)).toEqual(action);
    }
  });

  it("rejects arbitrary registration hosts", () => {
    expect(
      imManagementSchema.safeParse({
        action: "feishu-scan-begin",
        domain: "https://example.test",
      }).success,
    ).toBe(false);
  });
});
