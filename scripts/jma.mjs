/**
 * Shared pieces of the two JMA pipelines.
 *
 * build-phenology.mjs reads 生物季節観測 累年値 (per station, MMDD integers) and
 * build-tsuyu.mjs reads 梅雨入りと梅雨明け (per 地方, month and day in separate
 * columns). Almost nothing about the two parses is common — but the Shift_JIS
 * fetch, the calendar, and the era arithmetic are, and the calendar in particular
 * has to agree between them or the two datasets land on different day numbers.
 */

/**
 * Era windows for the "then vs now" comparison. Kept deliberately equal in
 * length so the two means are comparable, and shared by both datasets so a
 * 梅雨 shift can be read against a 桜 shift.
 */
export const ERAS = {
  early: [1953, 1982],
  late: [1996, 2025],
};

/**
 * First day-of-year of each month on a common non-leap calendar.
 *
 * Duplicated in src/ui.ts, which needs the inverse for its date readout.
 * `tsconfig.json` has `include: ["src"]` and these scripts are plain .mjs, so
 * sharing across the boundary would need a loader — not worth it for twelve
 * numbers, but if the calendar convention ever changes, both must change.
 */
export const MONTH_STARTS = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];

/** Month and day -> day of year, or null if the pair is not a real date. */
export function monthDayToDoy(month, day) {
  if (!Number.isFinite(month) || !Number.isFinite(day)) return null;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return MONTH_STARTS[month - 1] + day;
}

/** Day of year -> `{ month, day }`, the inverse of the above. */
export function doyToMonthDay(doy) {
  const clamped = Math.min(Math.max(Math.round(doy), 1), 365);
  let month = 11;
  while (month > 0 && MONTH_STARTS[month] >= clamped) month -= 1;
  return { month: month + 1, day: clamped - MONTH_STARTS[month] };
}

export function mean(values) {
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/**
 * Mean over one era window, or null when the window is too thin to mean.
 *
 * `series` is a `Map<year, doy>`. The five-observation floor is what keeps a
 * station with two readings in thirty years from reporting a trend.
 */
export function eraMean(series, [from, to]) {
  const values = [];
  for (const [year, doy] of series) {
    if (year >= from && year <= to) values.push(doy);
  }
  return values.length >= 5 ? mean(values) : null;
}

/** Same, but also reports how many observations the mean rests on. */
export function eraMeanWithCount(series, [from, to]) {
  const values = [];
  for (const [year, doy] of series) {
    if (year >= from && year <= to) values.push(doy);
  }
  return { value: values.length >= 5 ? mean(values) : null, n: values.length };
}

export async function fetchShiftJis(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} -> ${res.status}`);
  return new TextDecoder("shift_jis").decode(await res.arrayBuffer());
}

/** Splits a CSV into cell arrays, dropping blank and single-cell lines. */
export function parseCsv(text) {
  return text
    .split(/\r?\n/)
    .map((line) => line.split(","))
    .filter((cells) => cells.length > 2);
}

/** JMA pads and spaces its labels; compare on the squeezed form. */
export function squeeze(value) {
  return (value ?? "").replace(/[\s　]+/g, "");
}

export function round1(value) {
  return Math.round(value * 10) / 10;
}
