// D#76 PR9B cat-data-09: one summary stat for the Token Usage page.
// Decision A2 (parent ruling 2026-08-30): this stays a presentation-only
// local component over the existing five-column token-usage-summary bar.
// No generic .card/.stat-card classes and no layout of its own — the page
// keeps the section container and the bar styles in styles.css untouched.
export function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="token-usage-summary-item">
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}
