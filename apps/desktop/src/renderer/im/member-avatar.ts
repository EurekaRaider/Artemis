import type { CSSProperties } from "react";

/** Stable person colors shared by the roster and conversation avatars. */
export function memberAvatarStyle(id: string): CSSProperties {
  let hash = 0;
  for (const character of id)
    hash = (Math.imul(hash, 31) + character.codePointAt(0)!) | 0;
  const hues = [25, 65, 130, 175, 215, 255, 295, 335];
  return { "--member-hue": hues[(hash >>> 0) % hues.length] } as CSSProperties;
}
