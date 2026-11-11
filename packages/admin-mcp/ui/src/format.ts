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

/**
 * The last `days` UTC days up to today, with the rows the API sent; it leaves out empty days, so
 * the rest are zero (context7app's dateRangeLastNDays window).
 */
export function fillDays<T extends { date: string }>(
  rows: T[],
  empty: (date: string) => T,
  days: number
): T[] {
  const byDate = new Map(rows.map((row) => [row.date.slice(0, 10), row]));
  const day = new Date();
  day.setUTCDate(day.getUTCDate() - days + 1);
  return Array.from({ length: days }, () => {
    const date = day.toISOString().slice(0, 10);
    day.setUTCDate(day.getUTCDate() + 1);
    return byDate.get(date) ?? empty(date);
  });
}
