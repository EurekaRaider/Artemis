const HAN_CHARACTER = /\p{Script=Han}/u;
const USERNAME_SEGMENT = /[\p{L}\p{N}]+/gu;

export function userInitials(userName: string): string {
  const firstHanCharacter = Array.from(userName.trim()).find((character) =>
    HAN_CHARACTER.test(character),
  );
  if (firstHanCharacter) return firstHanCharacter;

  const segments = userName.match(USERNAME_SEGMENT) ?? [];
  const firstInitial = Array.from(segments[0] ?? "")[0];
  if (!firstInitial) return "?";
  const lastInitial =
    segments.length > 1 ? Array.from(segments.at(-1) ?? "")[0] : undefined;
  return `${firstInitial}${lastInitial ?? ""}`.toLocaleUpperCase("en-US");
}
