import { expect, it } from "vitest";
import { memberAvatarStyle } from "../../../src/renderer/im/member-avatar.js";

it("keeps each person's color stable across both avatar surfaces and distributes identities over eight hues", () => {
  const style = memberAvatarStyle("slack:person-one");
  expect(memberAvatarStyle("slack:person-one")).toEqual(style);
  const hues = new Set(
    Array.from(
      { length: 32 },
      (_, index) =>
        memberAvatarStyle(`member-${index}`)[
          "--member-hue" as keyof ReturnType<typeof memberAvatarStyle>
        ],
    ),
  );
  expect(hues.size).toBe(8);
});
