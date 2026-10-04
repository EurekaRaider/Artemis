export interface StartupTimingMark {
  stage: string;
  elapsedMs: number;
  deltaMs: number;
}

function milliseconds(value: number) {
  return Math.round(Math.max(0, value) * 10) / 10;
}

export function createStartupTiming(
  now: () => number = () => performance.now(),
) {
  const startedAt = now();
  let previousAt = startedAt;

  return {
    mark(stage: string): StartupTimingMark {
      const currentAt = now();
      const timing = {
        stage,
        elapsedMs: milliseconds(currentAt - startedAt),
        deltaMs: milliseconds(currentAt - previousAt),
      };
      previousAt = currentAt;
      return timing;
    },
  };
}
