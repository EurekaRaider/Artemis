import { describe, expect, it } from "vitest";

import {
  latestAutomationOccurrence,
  nextAutomationOccurrence,
} from "../src/main/automation-schedule.js";

describe("automation schedule", () => {
  it("advances interval schedules from the supplied run anchor", () => {
    expect(
      nextAutomationOccurrence(
        { kind: "interval", every: 30, unit: "minutes" },
        "2026-07-30T04:00:00.000Z",
      ),
    ).toBe("2026-07-30T04:30:00.000Z");
    expect(
      nextAutomationOccurrence(
        { kind: "interval", every: 2, unit: "hours" },
        "2026-07-30T04:00:00.000Z",
      ),
    ).toBe("2026-07-30T06:00:00.000Z");
  });

  it("calculates daily and weekday presets in their stored time zone", () => {
    const daily = {
      kind: "weekly" as const,
      daysOfWeek: [1, 2, 3, 4, 5, 6, 7],
      localTime: "09:30",
      timeZone: "Asia/Shanghai",
    };
    expect(nextAutomationOccurrence(daily, "2026-07-30T00:00:00.000Z")).toBe(
      "2026-07-30T01:30:00.000Z",
    );

    const weekdays = { ...daily, daysOfWeek: [1, 2, 3, 4, 5] };
    expect(nextAutomationOccurrence(weekdays, "2026-07-31T02:00:00.000Z")).toBe(
      "2026-08-03T01:30:00.000Z",
    );
  });

  it("coalesces missed recurring occurrences to the latest one", () => {
    const daily = {
      kind: "weekly" as const,
      daysOfWeek: [1, 2, 3, 4, 5, 6, 7],
      localTime: "09:30",
      timeZone: "Asia/Shanghai",
    };
    expect(latestAutomationOccurrence(daily, "2026-07-30T04:00:00.000Z")).toBe(
      "2026-07-30T01:30:00.000Z",
    );
  });

  it("moves a nonexistent DST time forward and chooses one repeated time", () => {
    const sunday = {
      kind: "weekly" as const,
      daysOfWeek: [7],
      localTime: "02:30",
      timeZone: "America/New_York",
    };
    expect(nextAutomationOccurrence(sunday, "2026-03-08T05:00:00.000Z")).toBe(
      "2026-03-08T07:30:00.000Z",
    );
    expect(
      nextAutomationOccurrence(
        { ...sunday, localTime: "01:30" },
        "2026-11-01T04:00:00.000Z",
      ),
    ).toBe("2026-11-01T05:30:00.000Z");
  });

  it("runs only on the interval grid inside the selected local window", () => {
    const schedule = {
      kind: "windowed-interval" as const,
      every: 30,
      unit: "minutes" as const,
      startTime: "09:00",
      endTime: "18:00",
      daysOfWeek: [1, 2, 3, 4, 5],
      timeZone: "Asia/Shanghai",
    };

    expect(nextAutomationOccurrence(schedule, "2026-07-30T01:14:00.000Z")).toBe(
      "2026-07-30T01:30:00.000Z",
    );
    expect(nextAutomationOccurrence(schedule, "2026-07-30T10:01:00.000Z")).toBe(
      "2026-07-31T01:00:00.000Z",
    );
    expect(
      latestAutomationOccurrence(schedule, "2026-07-30T01:44:00.000Z"),
    ).toBe("2026-07-30T01:30:00.000Z");
  });

  it("continues a cross-midnight window from its selected start day", () => {
    const schedule = {
      kind: "windowed-interval" as const,
      every: 2,
      unit: "hours" as const,
      startTime: "22:00",
      endTime: "06:00",
      daysOfWeek: [5],
      timeZone: "Asia/Shanghai",
    };

    expect(nextAutomationOccurrence(schedule, "2026-07-31T13:00:00.000Z")).toBe(
      "2026-07-31T14:00:00.000Z",
    );
    expect(nextAutomationOccurrence(schedule, "2026-07-31T17:00:00.000Z")).toBe(
      "2026-07-31T18:00:00.000Z",
    );
    expect(nextAutomationOccurrence(schedule, "2026-08-01T00:00:00.000Z")).toBe(
      "2026-08-07T14:00:00.000Z",
    );
  });
});
