export function formatUserInputCountdown(milliseconds: number): string {
  const seconds = Math.max(0, Math.ceil(milliseconds / 1_000));
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, "0")}`;
}
