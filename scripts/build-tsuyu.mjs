/**
 * Builds public/data/tsuyu.geojson from JMA's 梅雨入りと梅雨明け（確定値）.
 *
 * A different dataset from the one build-phenology.mjs reads, in three ways that
 * shape everything downstream:
 *
 * - It is per 地方, not per station. Twelve regions, one date for each, so the
 *   map counts 地方 and not 地点.
 * - It carries a real END date. The three biological series synthesise theirs
 *   from a fixed lag, but 梅雨明け is announced.
 * - 北海道 is absent, because JMA defines no 梅雨 there. That is the finding, not
 *   a gap, so this build asserts it: the 86 stations in the twelve regions plus
 *   16 in Hokkaido must account for every feature in phenology.geojson.
 *
 * The CSV is Shift_JIS with month and day in separate integer columns
 * (`5,10` = 10 May) and -9999 where the date could not be determined. It is read
 * positionally — column 1 + 4i for region i — which is fast and brittle, so the
 * parsed 平年 row is asserted against JMA's published twelve pairs. If JMA ever
 * inserts or reorders a column, that assertion fails instead of the build quietly
 * attributing one region's dates to its neighbour.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  ERAS,
  doyToMonthDay,
  eraMeanWithCount,
  fetchShiftJis,
  mean,
  monthDayToDoy,
  parseCsv,
  round1,
  squeeze,
} from "./jma.mjs";
import {
  EXPECTED_HEADERS,
  EXPECTED_NORMALS,
  NO_TSUYU,
  REGIONS,
} from "./regions.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = resolve(ROOT, "public/data/tsuyu.geojson");
const PHENOLOGY = resolve(ROOT, "public/data/phenology.geojson");

const BAIU = "https://www.data.jma.go.jp/cpd/baiu";

/**
 * 梅雨 is a May-to-August phenomenon, so every date must land well inside the
 * year — the extremes in the whole 1951–2025 record are 4月28日 (118) and
 * 8月10日 (222). build-phenology.mjs needs a `wrapAfter` because 桜 straddles the
 * new year; the positive-check equivalent here is to assert the range and throw,
 * rather than silently "correcting" a date that should never have been out of it.
 */
const DOY_RANGE = [110, 230];

function fail(message) {
  throw new Error(message);
}

/** One `入り` or `明け` cell pair -> day of year, or null for 特定できず. */
function pairToDoy(monthCell, dayCell, where) {
  const month = Number.parseInt(monthCell?.trim() ?? "", 10);
  const day = Number.parseInt(dayCell?.trim() ?? "", 10);
  // JMA writes -9999 in both halves when the transition could not be pinned to
  // a date at all. Not missing data in the usual sense: the season happened, but
  // no single day could be named for its edge.
  if (month === -9999 || day === -9999) return null;
  const doy = monthDayToDoy(month, day);
  if (doy === null) fail(`${where}: not a date: ${monthCell},${dayCell}`);
  if (doy < DOY_RANGE[0] || doy > DOY_RANGE[1]) {
    fail(`${where}: day-of-year ${doy} outside ${DOY_RANGE.join("..")}`);
  }
  return doy;
}

/**
 * Parses tsuyu_iriake.csv.
 *
 * Row 0 names each region in its first of four columns, row 1 is the
 * 入り（月）/入り（日）/明け（月）/明け（日） sub-header, row 2 is 平年, and rows 3+
 * are 1951 onward.
 */
function parseIriake(text) {
  const rows = parseCsv(text);

  const width = 1 + REGIONS.length * 4;
  if (rows[0].length !== width) {
    fail(`tsuyu_iriake.csv: expected ${width} columns, got ${rows[0].length}`);
  }
  EXPECTED_HEADERS.forEach((expected, i) => {
    const actual = squeeze(rows[0][1 + i * 4]);
    if (!actual.includes(expected)) {
      fail(`tsuyu_iriake.csv: column ${1 + i * 4} is "${actual}", expected to contain "${expected}"`);
    }
  });

  const normalRow = rows.find((cells) => squeeze(cells[0]) === "平年");
  if (!normalRow) fail("tsuyu_iriake.csv: no 平年 row");

  const yearRows = rows.filter((cells) => {
    const year = Number.parseInt(cells[0]?.trim() ?? "", 10);
    return Number.isInteger(year) && year >= 1900 && year <= 2100;
  });
  if (yearRows.length === 0) fail("tsuyu_iriake.csv: no year rows");

  return REGIONS.map((region, i) => {
    const base = 1 + i * 4;
    const iri = new Map();
    const ake = new Map();
    let iriUndetermined = 0;
    let akeUndetermined = 0;

    for (const cells of yearRows) {
      const year = Number.parseInt(cells[0].trim(), 10);
      const where = `${region.name} ${year}`;
      const start = pairToDoy(cells[base], cells[base + 1], `${where} 入り`);
      const end = pairToDoy(cells[base + 2], cells[base + 3], `${where} 明け`);
      if (start === null) iriUndetermined += 1;
      else iri.set(year, start);
      if (end === null) akeUndetermined += 1;
      else ake.set(year, end);
    }

    return {
      region,
      normals: {
        iri: pairToDoy(normalRow[base], normalRow[base + 1], `${region.name} 平年 入り`),
        ake: pairToDoy(normalRow[base + 2], normalRow[base + 3], `${region.name} 平年 明け`),
      },
      iri,
      ake,
      iriUndetermined,
      akeUndetermined,
      years: [
        Number.parseInt(yearRows[0][0].trim(), 10),
        Number.parseInt(yearRows.at(-1)[0].trim(), 10),
      ],
    };
  });
}

/**
 * Parses tsuyu_prec.csv — the 梅雨 period's rainfall as a percentage of normal,
 * averaged over each region. 13 columns, and no 平年 row, because the normal is
 * 100 by definition.
 */
function parsePrec(text) {
  const rows = parseCsv(text);
  const width = 1 + REGIONS.length;
  if (rows[0].length !== width) {
    fail(`tsuyu_prec.csv: expected ${width} columns, got ${rows[0].length}`);
  }
  EXPECTED_HEADERS.forEach((expected, i) => {
    const actual = squeeze(rows[0][1 + i]);
    if (!actual.includes(expected)) {
      fail(`tsuyu_prec.csv: column ${1 + i} is "${actual}", expected "${expected}"`);
    }
  });

  return REGIONS.map((_, i) => {
    const series = new Map();
    for (const cells of rows) {
      const year = Number.parseInt(cells[0]?.trim() ?? "", 10);
      if (!Number.isInteger(year) || year < 1900 || year > 2100) continue;
      const value = Number.parseInt(cells[1 + i]?.trim() ?? "", 10);
      if (!Number.isFinite(value) || value === -9999) continue;
      series.set(year, value);
    }
    return series;
  });
}

/** Asserts the 地方 partition covers phenology.geojson exactly once each. */
function checkPartition(stationsByName) {
  const owner = new Map();
  const clash = [];
  const register = (name, where) => {
    if (owner.has(name)) clash.push(`${name} in both ${owner.get(name)} and ${where}`);
    else owner.set(name, where);
  };
  for (const region of REGIONS) {
    for (const name of region.stations) register(name, region.name);
  }
  for (const name of NO_TSUYU.stations) register(name, NO_TSUYU.name);

  const absent = [...owner.keys()].filter((name) => !stationsByName.has(name));
  const unlisted = [...stationsByName.keys()].filter((name) => !owner.has(name));

  if (clash.length || absent.length || unlisted.length) {
    fail(
      "地方 partition does not match phenology.geojson:\n" +
        [
          clash.length && `  listed twice: ${clash.join("; ")}`,
          absent.length && `  listed but not in phenology.geojson: ${absent.join(" ")}`,
          unlisted.length && `  in phenology.geojson but unlisted: ${unlisted.join(" ")}`,
        ]
          .filter(Boolean)
          .join("\n"),
    );
  }

  const inRegions = REGIONS.reduce((n, r) => n + r.stations.length, 0);
  console.log(
    `partition: ${inRegions} stations in 12 地方 + ${NO_TSUYU.stations.length} in ${NO_TSUYU.name} ` +
      `= ${inRegions + NO_TSUYU.stations.length} (${stationsByName.size} features) ✓`,
  );
}

function label(doy) {
  const { month, day } = doyToMonthDay(doy);
  return `${month}月${day}日頃`;
}

/** All-years mean, era means with their counts, and the era shift. */
function summarise(properties, key, series) {
  const all = [...series.values()];
  if (all.length === 0) return;
  properties[`${key}_mean`] = round1(mean(all));
  properties[`${key}_n`] = all.length;

  const eras = {};
  for (const [eraName, window] of Object.entries(ERAS)) {
    const { value, n } = eraMeanWithCount(series, window);
    // The count goes out even when the mean does not: a 梅雨明け era mean resting
    // on 23 of 30 years has to be readable as such, because the seven it is
    // missing are the years no date could be named — which are the anomalous ones.
    properties[`${key}_${eraName}_n`] = n;
    if (value === null) continue;
    eras[eraName] = value;
    properties[`${key}_${eraName}`] = round1(value);
  }
  if (eras.early !== undefined && eras.late !== undefined) {
    properties[`${key}_shift`] = round1(eras.late - eras.early);
  }
}

async function main() {
  const [iriakeText, precText, phenologyText] = await Promise.all([
    fetchShiftJis(`${BAIU}/tsuyu_iriake.csv`),
    fetchShiftJis(`${BAIU}/tsuyu_prec.csv`),
    readFile(PHENOLOGY, "utf8"),
  ]);

  const parsed = parseIriake(iriakeText);
  const prec = parsePrec(precText);

  // The whole guarantee on the positional parse.
  parsed.forEach(({ region, normals }, i) => {
    const [iri, ake] = EXPECTED_NORMALS[i];
    if (normals.iri !== iri || normals.ake !== ake) {
      fail(
        `${region.name} 平年 parsed as ${normals.iri}/${normals.ake}, ` +
          `expected ${iri}/${ake} — the CSV column layout has changed`,
      );
    }
  });
  console.log(`平年 row matches all ${EXPECTED_NORMALS.length} published pairs ✓`);

  const phenology = JSON.parse(phenologyText);
  const stationsByName = new Map(
    phenology.features.map((feature) => [feature.properties.name, feature]),
  );
  checkPartition(stationsByName);

  const features = parsed.map(({ region, normals, iri, ake, iriUndetermined, akeUndetermined }, i) => {
    const anchor = stationsByName.get(region.anchor);
    const properties = {
      code: region.code,
      id: region.id,
      name: region.name,
      nameEn: region.nameEn,
      // Where the region is drawn. A real station from phenology.geojson, so no
      // coordinate in this pipeline is invented or averaged into the sea.
      anchorStation: region.anchor,
      alt: anchor.properties.alt,
      prefectures: region.prefectures,
      stations: region.stations,
      stationCount: region.stations.length,

      // What the map animates: JMA's own 1991–2020 normals, taken verbatim from
      // the 平年 row rather than averaged over all years. The undetermined 明け
      // are not missing at random — they are the anomalously late seasons — so an
      // all-years mean would be biased early by exactly the years that matter.
      tsuyuIri: normals.iri,
      tsuyuAke: normals.ake,
      tsuyuSpan: normals.ake - normals.iri,
      tsuyuIriLabel: label(normals.iri),
      tsuyuAkeLabel: label(normals.ake),

      tsuyuIri_undetermined: iriUndetermined,
      tsuyuAke_undetermined: akeUndetermined,
    };

    summarise(properties, "tsuyuIri", iri);
    summarise(properties, "tsuyuAke", ake);
    summarise(properties, "prec", prec[i]);

    return {
      type: "Feature",
      geometry: { type: "Point", coordinates: anchor.geometry.coordinates },
      properties,
    };
  });

  const years = parsed[0].years;
  const totalIri = parsed.reduce((n, p) => n + p.iriUndetermined, 0);
  const totalAke = parsed.reduce((n, p) => n + p.akeUndetermined, 0);

  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(
    OUT,
    JSON.stringify(
      {
        type: "FeatureCollection",
        metadata: {
          source: "気象庁 梅雨入りと梅雨明け（確定値）",
          sourceUrl: `${BAIU}/index.html`,
          csv: ["tsuyu_iriake.csv", "tsuyu_prec.csv"],
          years,
          normals: [1991, 2020],
          eras: ERAS,
          anchorCoordinates:
            "気象庁 AMeDAS 観測所一覧, via public/data/phenology.geojson",
          transitionDays: 5,
          transitionNote:
            "JMA announces both edges as 「○月○日頃」 because there is a " +
            "平均５日間程度 transition at each, so no single day can be named. Those " +
            "five days are the renderer's onset and withdrawal ramps, and both sit " +
            "inside the announced window, so nothing is drawn on a day JMA did not name.",
          undetermined: {
            iri: totalIri,
            ake: totalAke,
            note:
              "Seasons whose edge could not be pinned to a date. 梅雨明け is far more " +
              "often indeterminate than 梅雨入り, and the count rises with latitude: " +
              "none at all in 沖縄 or 奄美, eight in 東北北部. 1993 alone accounts for ten " +
              "of them — every region except 沖縄 and 奄美.",
          },
          hokkaido: {
            regions: 0,
            stations: NO_TSUYU.stations.length,
            note:
              "北海道に梅雨はない。JMA defines no 梅雨 for Hokkaido — 梅雨前線は北海道付近" +
              "では不明瞭となることが多い. Its 16 stations belong to no region here, and the " +
              "build asserts 86 + 16 = 102 against phenology.geojson so the absence is " +
              "checked rather than inferred.",
          },
          note:
            "梅雨 is announced for a whole 地方, so the unit here is the region and not " +
            "the observation station: there is no Shizuoka reading, only 東海's. " +
            "Per-year values are deliberately not shipped — the map animates one " +
            "climatological year — but all-years and era means are, for reference.",
        },
        features,
      },
      null,
      1,
    ),
  );

  console.log(`\nwrote ${features.length} 地方 -> ${OUT}\n`);
  console.log("地方        平年              span  入り n/未  明け n/未  入りshift 明けshift  降水%");
  for (const feature of features) {
    const p = feature.properties;
    const cell = (value, width) => String(value ?? "—").padStart(width);
    console.log(
      p.name.padEnd(6, "　") +
        ` ${p.tsuyuIriLabel.padStart(8)} → ${p.tsuyuAkeLabel.padStart(8)}` +
        cell(p.tsuyuSpan, 6) +
        cell(`${p.tsuyuIri_n}/${p.tsuyuIri_undetermined}`, 9) +
        cell(`${p.tsuyuAke_n}/${p.tsuyuAke_undetermined}`, 10) +
        cell(p.tsuyuIri_shift, 10) +
        cell(p.tsuyuAke_shift, 9) +
        cell(p.prec_shift, 8),
    );
  }
  console.log(
    `\nundetermined over ${years[0]}–${years[1]}: ` +
      `梅雨入り ${totalIri}, 梅雨明け ${totalAke}`,
  );
  console.log(
    `${NO_TSUYU.note} — ${NO_TSUYU.stations.length} stations in no region: ` +
      NO_TSUYU.stations.join(" "),
  );
}

await main();
