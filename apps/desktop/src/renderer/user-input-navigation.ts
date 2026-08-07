export type UserInputNavigationKey = "ArrowDown" | "ArrowUp" | "Home" | "End";

export function moveUserInputOptionFocus(
  currentIndex: number,
  optionCount: number,
  key: UserInputNavigationKey,
): number {
  if (optionCount <= 0) return -1;
  if (key === "Home") return 0;
  if (key === "End") return optionCount - 1;
  if (key === "ArrowDown") return (currentIndex + 1) % optionCount;
  return (currentIndex - 1 + optionCount) % optionCount;
}
