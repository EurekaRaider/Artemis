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

// D#76 PR10C (decision M option 2): question-level navigation for the
// multi-question card's dots tablist. Wrap semantics mirror
// moveUserInputOptionFocus above (v17 prototype components.html:2084-2091);
// the card-level global ArrowLeft/Right domain is deliberately omitted.
export type UserInputQuestionNavigationKey =
  "ArrowLeft" | "ArrowRight" | "Home" | "End";

export function moveUserInputQuestionFocus(
  currentIndex: number,
  questionCount: number,
  key: UserInputQuestionNavigationKey,
): number {
  if (questionCount <= 0) return -1;
  if (key === "Home") return 0;
  if (key === "End") return questionCount - 1;
  if (key === "ArrowRight") return (currentIndex + 1) % questionCount;
  return (currentIndex - 1 + questionCount) % questionCount;
}
