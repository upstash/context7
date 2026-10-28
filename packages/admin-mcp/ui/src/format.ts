export const num = (value: number) =>
  value >= 10_000
    ? new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 }).format(
        value
      )
    : value.toLocaleString();

export const usd = (dollars: number) =>
  new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: dollars !== 0 && Math.abs(dollars) < 10 ? 2 : 0,
  }).format(dollars);

export const pct = (part: number, whole: number) =>
  whole > 0 ? `${Math.round((part / whole) * 100)}%` : "–";

export const ago = (iso: string) => {
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  if (minutes < 48 * 60) return `${Math.round(minutes / 60)} h ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
};

/** Every day from the first to the last date, with the rows the API sent (it leaves out empty days). */
export function fillDays<T extends { date: string }>(rows: T[], empty: (date: string) => T): T[] {
  if (rows.length === 0) return [];
  const byDate = new Map(rows.map((row) => [row.date.slice(0, 10), row]));
  const sorted = [...byDate.keys()].sort();
  const out: T[] = [];
  for (
    let day = new Date(`${sorted[0]}T00:00:00Z`);
    day <= new Date(`${sorted[sorted.length - 1]}T00:00:00Z`);
    day.setUTCDate(day.getUTCDate() + 1)
  ) {
    const date = day.toISOString().slice(0, 10);
    out.push(byDate.get(date) ?? empty(date));
  }
  return out;
}
