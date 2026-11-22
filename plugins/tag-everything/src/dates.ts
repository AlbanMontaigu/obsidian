// Date criteria of a search (the panel's, the inbox's): created / modified recently or long ago. Pure, no
// `obsidian` import (unit-tested). The menu that picks them is menu.ts `dateMenu`.

export const DAY_MS = 24 * 3600_000;

/** Which date of a file a criterion reads: `stat.ctime` or `stat.mtime`. */
export type DateField = "created" | "modified";
export const DATE_FIELDS: readonly DateField[] = ["created", "modified"];

/** `within`: in the last `days` days; otherwise more than `days` days ago. */
export interface DateRange {
  within: boolean;
  days: number;
}

/** At most one range per field; a field left out matches any date. */
export type DateFilters = Partial<Record<DateField, DateRange>>;

/** The ranges offered in the menu: recent, then old. */
export const DATE_PRESETS: readonly DateRange[] = [
  { within: true, days: 1 },
  { within: true, days: 7 },
  { within: true, days: 30 },
  { within: true, days: 90 },
  { within: true, days: 365 },
  { within: false, days: 30 },
  { within: false, days: 90 },
  { within: false, days: 365 },
];

/** The two dates a criterion reads (a file's `stat`). */
export interface FileTimes {
  ctime: number;
  mtime: number;
}

/** `in the last 30 days`, `in the last day`, `more than a year ago`. */
export function rangeText(r: DateRange): string {
  const unit = r.days === 1 ? "day" : r.days === 365 ? "year" : "";
  return r.within ? `in the last ${unit || `${r.days} days`}` : `more than ${unit ? `a ${unit}` : `${r.days} days`} ago`;
}

/** `created in the last 30 days`. */
export function criterionText(field: DateField, r: DateRange): string {
  return `${field} ${rangeText(r)}`;
}

/** Every criterion set, joined: `created in the last 7 days, modified more than a year ago`; "" when none. */
export function filtersText(f: DateFilters): string {
  return DATE_FIELDS.flatMap((k) => (f[k] ? [criterionText(k, f[k])] : [])).join(", ");
}

export function hasDates(f: DateFilters): boolean {
  return DATE_FIELDS.some((k) => !!f[k]);
}

export function sameRange(a: DateRange | undefined, b: DateRange | undefined): boolean {
  return !!a && !!b && a.within === b.within && a.days === b.days;
}

/** Is `time` in the range, `now` being the reference? */
export function inRange(time: number, r: DateRange, now: number): boolean {
  const since = now - r.days * DAY_MS;
  return r.within ? time >= since : time < since;
}

/** Do the file's dates meet every criterion set? An item without dates (a folder: `null`) meets none. */
export function datesMatch(f: DateFilters, times: FileTimes | null, now: number): boolean {
  if (!hasDates(f)) return true;
  if (!times) return false;
  return (!f.created || inRange(times.ctime, f.created, now)) && (!f.modified || inRange(times.mtime, f.modified, now));
}

/** The criteria from a saved state (workspace.json): anything damaged is dropped, never throws. */
export function normalizeDates(raw: unknown): DateFilters {
  const out: DateFilters = {};
  if (!raw || typeof raw !== "object") return out;
  const o = raw as Record<string, unknown>;
  for (const k of DATE_FIELDS) {
    const r = o[k] as Partial<DateRange> | undefined;
    if (r && typeof r.within === "boolean" && typeof r.days === "number" && Number.isInteger(r.days) && r.days > 0) out[k] = { within: r.within, days: r.days };
  }
  return out;
}
