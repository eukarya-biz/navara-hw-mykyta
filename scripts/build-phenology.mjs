/**
 * Builds public/data/phenology.geojson from JMA's 生物季節観測 累年値 CSVs.
 *
 * The CSVs are Shift_JIS, one row per observation station, with a pair of
 * columns per year: the observation as an MMDD integer (`430` = 30 April,
 * `0` = not observed) followed by a remark code we ignore.
 *
 * Station coordinates are not in those CSVs, so stations are joined to JMA's
 * AMeDAS table by Japanese name. That table also carries `alt`, which is what
 * lets the elevation story be told at all.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = resolve(ROOT, "public/data/phenology.geojson");

const RUINENCHI = "https://www.data.jma.go.jp/sakura/data/ruinenchi";
const AMEDAS = "https://www.jma.go.jp/bosai/amedas/const/amedastable.json";

/** JMA 累年値 series we need, by their file number. */
const SERIES = {
  sakuraKaika: { file: "004", label: "さくら開花" },
  sakuraMankai: { file: "005", label: "さくら満開" },
  kaedeKouyou: { file: "015", label: "かえで紅葉" },
  ichoOuyou: { file: "013", label: "いちょう黄葉" },
};

/**
 * Era windows for the "then vs now" comparison. Kept deliberately equal in
 * length so the two means are comparable.
 */
const ERAS = {
  early: [1953, 1982],
  late: [1996, 2025],
};

/** 生物季節 station names that differ from the AMeDAS spelling. */
const NAME_ALIASES = {
  南大東島: "南大東",
};

const MONTH_STARTS = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];

/** MMDD integer -> day of year, on a common non-leap calendar. */
function mmddToDoy(mmdd) {
  const month = Math.floor(mmdd / 100);
  const day = mmdd % 100;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return MONTH_STARTS[month - 1] + day;
}

function mean(values) {
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

async function fetchShiftJis(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} -> ${res.status}`);
  return new TextDecoder("shift_jis").decode(await res.arrayBuffer());
}

/**
 * Parses one 累年値 CSV into `Map<stationName, Map<year, doy>>`.
 * Row 1 is a title, row 2 is the header carrying the year for each value column.
 */
function parseRuinenchi(text) {
  const rows = text
    .split(/\r?\n/)
    .map((line) => line.split(","))
    .filter((cells) => cells.length > 2);

  const header = rows[1];
  const yearAt = new Map();
  header.forEach((cell, index) => {
    const year = Number.parseInt(cell.trim(), 10);
    if (Number.isFinite(year) && year > 1800) yearAt.set(index, year);
  });

  const byStation = new Map();
  for (const cells of rows.slice(2)) {
    const code = cells[0]?.trim();
    // Station rows start with a numeric 番号; trailing notes rows do not.
    if (!/^\d+$/.test(code ?? "")) continue;
    // Names are padded with ideographic spaces to a fixed width.
    const name = cells[1]?.replace(/[\s　]+/g, "");
    if (!name) continue;

    const series = new Map();
    for (const [index, year] of yearAt) {
      const raw = Number.parseInt(cells[index]?.trim() ?? "", 10);
      if (!Number.isFinite(raw) || raw === 0) continue;
      const doy = mmddToDoy(raw);
      if (doy !== null) series.set(year, doy);
    }
    if (series.size > 0) byStation.set(name, series);
  }
  return byStation;
}

function eraMean(series, [from, to]) {
  const values = [];
  for (const [year, doy] of series) {
    if (year >= from && year <= to) values.push(doy);
  }
  return values.length >= 5 ? mean(values) : null;
}

async function main() {
  const amedas = await (await fetch(AMEDAS)).json();

  // Several AMeDAS entries share a name; prefer the richest ("A" type) record.
  const byName = new Map();
  for (const entry of Object.values(amedas)) {
    const existing = byName.get(entry.kjName);
    if (!existing || (existing.type !== "A" && entry.type === "A")) {
      byName.set(entry.kjName, entry);
    }
  }
  const toDegrees = ([deg, min]) => deg + min / 60;

  const parsed = {};
  for (const [key, { file, label }] of Object.entries(SERIES)) {
    parsed[key] = parseRuinenchi(await fetchShiftJis(`${RUINENCHI}/${file}.csv`));
    console.log(`${label} (${file}): ${parsed[key].size} stations`);
  }

  const names = new Set(Object.values(parsed).flatMap((m) => [...m.keys()]));
  const features = [];
  const unmatched = [];

  for (const name of names) {
    const station = byName.get(NAME_ALIASES[name] ?? name);
    if (!station) {
      unmatched.push(name);
      continue;
    }

    const properties = {
      name,
      nameEn: station.enName,
      alt: station.alt,
    };

    let hasAny = false;
    for (const key of Object.keys(SERIES)) {
      const series = parsed[key].get(name);
      if (!series) continue;
      const all = [...series.values()];
      properties[key] = Math.round(mean(all) * 10) / 10;
      properties[`${key}_n`] = all.length;
      for (const [eraName, window] of Object.entries(ERAS)) {
        const value = eraMean(series, window);
        if (value !== null) {
          properties[`${key}_${eraName}`] = Math.round(value * 10) / 10;
        }
      }
      hasAny = true;
    }
    if (!hasAny) continue;

    features.push({
      type: "Feature",
      geometry: {
        type: "Point",
        coordinates: [toDegrees(station.lon), toDegrees(station.lat)],
      },
      properties,
    });
  }

  features.sort((a, b) => a.properties.name.localeCompare(b.properties.name, "ja"));

  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(
    OUT,
    JSON.stringify(
      {
        type: "FeatureCollection",
        metadata: {
          source: "気象庁 生物季節観測 累年値",
          sourceUrl: "https://www.data.jma.go.jp/sakura/data/",
          stationCoordinates: "気象庁 AMeDAS 観測所一覧",
          eras: ERAS,
          note:
            "JMA's reference tree is ソメイヨシノ in most of Japan but 寒緋桜 in Okinawa " +
            "and エゾヤマザクラ in Hokkaido, so the front is not one species moving north. " +
            "Phenological observations were substantially reduced in 2021.",
        },
        features,
      },
      null,
      1,
    ),
  );

  console.log(`\nwrote ${features.length} stations -> ${OUT}`);
  if (unmatched.length) {
    console.log(`unmatched station names (${unmatched.length}):`, unmatched.join(" "));
  }
}

await main();
