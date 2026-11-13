/** How Artemis addresses the user; blank means the system user name applies. */
export const PROFILE_NAME_MAX_CHARACTERS = 40;

/** Returns the trimmed name, or undefined when blank. Throws when invalid. */
export function parseProfileName(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") throw new Error("Invalid profile name.");
  const name = value.trim();
  if (!name) return undefined;
  if (
    /[\p{Cc}\p{Zl}\p{Zp}]/u.test(name) ||
    Array.from(name).length > PROFILE_NAME_MAX_CHARACTERS
  ) {
    throw new Error(
      `Profile name must be at most ${PROFILE_NAME_MAX_CHARACTERS} characters on one line.`,
    );
  }
  return name;
}
