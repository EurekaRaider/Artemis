import { useState } from "react";

import { Button } from "@artemis/ui/actions";
import {
  DataHeatmap,
  DataStat,
  DataSurface,
  type DataHeatmapCell,
} from "@artemis/ui/data";
import { EmptyState, ErrorState, LoadingState } from "@artemis/ui/feedback";
import { Select } from "@artemis/ui/forms";
import { ManagementHeader } from "@artemis/ui/management";

const SYNTHETIC_CELLS = Object.freeze(
  Array.from({ length: 28 }, (_, index) => ({
    id: `synthetic-day-${index + 1}`,
    label: `Synthetic day ${index + 1}: ${index * 125} tokens`,
    level: (index % 5) as 0 | 1 | 2 | 3 | 4,
    periodKey: `synthetic-week-${Math.floor(index / 7) + 1}`,
    tooltipAlign: index >= 21 ? ("end" as const) : ("start" as const),
  })) satisfies readonly DataHeatmapCell[],
);

export function DataGallery() {
  const [activeCellId, setActiveCellId] = useState<string>();
  const [range, setRange] = useState("month");
  const [eventCount, setEventCount] = useState(0);

  return (
    <div className="gallery-data-grid">
      <div data-gallery-data-case="anatomy">
        <DataSurface
          className="gallery-data-surface"
          header={
            <ManagementHeader
              headingLevel={3}
              title="Synthetic usage overview"
            />
          }
          label="Synthetic usage"
          toolbar={
            <Select
              label="Range"
              onValueChange={setRange}
              options={[
                { label: "Month", value: "month" },
                { label: "Quarter", value: "quarter" },
              ]}
              value={range}
            />
          }
        >
          <div className="gallery-data-stats" aria-label="Synthetic totals">
            <DataStat label="Total tokens" value="48.2K" />
            <DataStat label="Active days" value="19" />
            <DataStat label="Longest streak" value="7 days" />
          </div>
          <div className="gallery-data-scroll">
            <DataHeatmap
              activeCellId={activeCellId}
              cells={SYNTHETIC_CELLS}
              columnLabels={[
                { column: 1, id: "week-one", label: "Week 1" },
                { column: 3, id: "week-three", label: "Week 3" },
              ]}
              columns={4}
              label="Synthetic token activity"
              onActiveCellChange={setActiveCellId}
              rows={7}
            />
          </div>
        </DataSurface>
      </div>

      <div data-gallery-data-case="state-matrix">
        <DataSurface label="Data state matrix" state="loading">
          <LoadingState label="Loading usage" lines={1} />
          <ErrorState>Usage could not be loaded.</ErrorState>
          <EmptyState title="No usage recorded" />
        </DataSurface>
      </div>

      <div data-gallery-data-case="controlled-events">
        <DataSurface label="Caller-owned data events">
          <Button onClick={() => setEventCount((count) => count + 1)}>
            Refresh synthetic data
          </Button>
          <output aria-live="polite" data-gallery-data-event-count>
            Refresh count: {eventCount}
          </output>
        </DataSurface>
      </div>

      <div dir="rtl" data-gallery-data-case="rtl-long-content">
        <DataSurface
          header={
            <ManagementHeader
              description="تبقى القيم والحسابات وعمليات التحميل مملوكة للتطبيق المستهلك"
              headingLevel={3}
              title="ملخص بيانات اصطناعية بعنوان محلي طويل للغاية"
            />
          }
          label="بيانات اصطناعية"
        >
          <DataStat
            label="إجمالي الرموز في الفترة المحلية الطويلة"
            value="١٢٣٬٤٥٦"
          />
        </DataSurface>
      </div>
    </div>
  );
}
