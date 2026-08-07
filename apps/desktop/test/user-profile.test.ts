import { describe, expect, it } from "vitest";

import { userInitials } from "../src/renderer/user-profile.js";

describe("user profile initials", () => {
  it("uses the first Han character when the username contains Chinese text", () => {
    expect(userInitials("王小明")).toBe("王");
    expect(userInitials("dev-李雷")).toBe("李");
  });

  it("uses uppercase initials from Latin username segments", () => {
    expect(userInitials("William Ji")).toBe("WJ");
    expect(userInitials("william.ji")).toBe("WJ");
    expect(userInitials("william_ji")).toBe("WJ");
    expect(userInitials("william")).toBe("W");
  });
});
