/**
 * Builds public/data/snow.geojson from JMA's 地上気象観測平年値 1991–2020.
 *
 * Unlike the other two datasets this one arrives as a 21 MB zip of per-station
 * CSVs rather than one CSV per series, so the shape of the parse is different:
 * a station index gives the roster and the coordinates, and then two files per
 * station carry the values. Getting the archive open and cut into rows lives in
 * normals.mjs, which build-heat.mjs shares.
 *
 * What stays here is the fragile part. The files are *code-keyed*, not
 * header-keyed, and there is no label anywhere in the archive saying which code
 * is which element — so every code below records how it was pinned down, and
 * `EXPECTED_SNOW` re-checks the result against hand-transcribed values before
 * anything is written.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { MONTH_STARTS, monthDayToDoy, round1 } from "./jma.mjs";
import {
  ANNUAL,
  assertInJapan,
  cell,
  degrees,
  fail,
  fetchNormals,
  monthIndex,
  NORMALS,
  readMonthly,
  readSeasonal,
  readStationIndex,
} from "./normals.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = resolve(ROOT, "public/data/snow.geojson");

/**
 * 季節現象 element codes, from `seasonal_phenomena/nml_sfc_sph_<block>.csv`.
 *
 * Values are MMDD integers; 0 means JMA publishes no normal for that element at
 * that station.
 *
 * Pinned down against the labelled per-station page
 * `nml_sfc_season.php`, 「平年値（霜・雪・結氷の初終日と初冠雪日）」, whose columns run
 * 雪 → 霜 → 結氷 in the same order as codes 7300/7400 → 7500/7600 → 7700/7800.
 * The ordering alone would be circumstantial, so it is confirmed by 旭川, where
 * 7500 is 10月9日 and 7300 is 10月19日: frost precedes snow in Asahikawa, which
 * fixes 7300 as 雪 and rules out the alternative reading.
 */
const SNOW_START = "7300"; // 雪の初日
const SNOW_END = "7400"; // 雪の終日

/**
 * Monthly element codes, from `monthly/nml_sfc_m_<block>.csv`.
 *
 * A different code namespace from the 季節現象 file — 6000 means 降雪の深さ合計
 * here and 積雪(≧0cm)の初日 there — which is the trap this whole comment block
 * exists to keep someone out of.
 *
 * Row layout is the one normals.mjs documents: `ANNUAL` is the annual value and
 * `monthIndex(m)` a month's.
 *
 * Pinned down by matching published annual normals: 6000 gives 青森 567 cm,
 * 金沢 157 cm, 新潟 139 cm, 東京 8 cm — JMA's 降雪量年合計平年値 exactly — and 6200
 * gives 青森 101 cm, 旭川 89 cm, which are the 最深積雪年平年値. 6100 sits between
 * them (金沢 26 cm) and is 降雪の深さ日合計の最大, which is why it is not used.
 */
const SNOWFALL_TOTAL = "6000"; // 降雪の深さ合計 (cm)
const MAX_DEPTH = "6200"; // 最深積雪 (cm)

/**
 * The fifteen stations in the surface network with no 雪の初日 normal.
 *
 * Hand-transcribed so the "no snow here" claim is a checked invariant rather
 * than whatever the parse happened to come up with — the same reason
 * regions.mjs keeps NO_TSUYU. It is the Ryukyus and 奄美, the two islands off
 * Kyushu, the Ogasawaras, and 昭和 — which is Syowa Station in Antarctica, part
 * of JMA's surface network and 69°S, hence the bounding-box assertion below.
 */
const NO_SNOW = [
  "屋久島",
  "種子島",
  "名瀬",
  "与那国島",
  "西表島",
  "石垣島",
  "宮古島",
  "久米島",
  "那覇",
  "名護",
  "沖永良部",
  "南大東島",
  "父島",
  "南鳥島",
  "昭和",
];

/**
 * Reference values, hand-transcribed from JMA's own per-station pages.
 *
 * Deep-checked before writing, for the same reason build-tsuyu.mjs checks
 * EXPECTED_NORMALS: the parse is positional and code-keyed, so a shifted column
 * or a reused code would otherwise mis-attribute silently. The nine stations
 * span the country and both sides of the spine on purpose — 金沢 and 東京 sit
 * about a degree apart in latitude and are the pair the whole mode is about.
 */
const EXPECTED_SNOW = {
  稚内: { start: [10, 19], end: [5, 10], depth: 72 },
  旭川: { start: [10, 19], end: [5, 1], depth: 89 },
  青森: { start: [11, 8], end: [4, 15], depth: 101 },
  新潟: { start: [11, 23], end: [4, 6], depth: 32 },
  金沢: { start: [11, 24], end: [4, 7], depth: 32 },
  長野: { start: [11, 18], end: [4, 8], depth: 33 },
  東京: { start: [1, 3], end: [3, 9], depth: 6 },
  高知: { start: [12, 21], end: [2, 21], depth: 1 },
  鹿児島: { start: [1, 5], end: [2, 17], depth: 3 },
};

/** MMDD integer -> day of year, or null when JMA publishes no normal (0). */
function mmddToDoy(mmdd) {
  if (!Number.isFinite(mmdd) || mmdd === 0) return null;
  return monthDayToDoy(Math.floor(mmdd / 100), mmdd % 100);
}

/**
 * The day-of-year 最深積雪 normally peaks, from the twelve monthly values.
 *
 * Months are compared in *season* order rather than calendar order — the season
 * crosses the new year, so a naive argmax over January…December would break a
 * December/January tie towards the earlier calendar month, which is the later
 * month of the season. Ties otherwise go to the later month, since depth
 * accumulates.
 *
 * Returns null for the twenty-two stations whose 最深積雪 is zero in every month:
 * they do get snow, it simply never lies, so there is no peak depth to find and
 * the caller falls back to the middle of the announced window.
 */
function peakDepthDoy(monthly, startDoy) {
  let best = null;
  for (let month = 1; month <= 12; month += 1) {
    const depth = cell(monthly, monthIndex(month));
    if (!Number.isFinite(depth) || depth <= 0) continue;
    const doy = MONTH_STARTS[month - 1] + 15;
    // Lifted into the same year as the start, so "later in the season" is a
    // plain numeric comparison. Same trick modes.ts uses for the same reason.
    const lifted = doy < startDoy ? doy + 365 : doy;
    if (!best || depth > best.depth || (depth === best.depth && lifted > best.lifted)) {
      best = { depth, doy, lifted };
    }
  }
  return best ? best.doy : null;
}

async function main() {
  const base = await fetchNormals(["seasonal_phenomena", "monthly"]);

  /* --- the roster ------------------------------------------------------- */

  const stations = await readStationIndex(base);
  console.log(`surface station index: ${stations.length} stations`);

  /* --- the values ------------------------------------------------------- */

  const features = [];
  const withoutSnow = [];
  const seen = new Map();

  for (const station of stations) {
    const seasonal = await readSeasonal(base, station.block);
    const monthly = await readMonthly(base, station.block);

    const startRow = seasonal.get(SNOW_START);
    const endRow = seasonal.get(SNOW_END);
    const start = mmddToDoy(cell(startRow, 6));
    const end = mmddToDoy(cell(endRow, 6));

    if (start === null || end === null) {
      withoutSnow.push(station.name);
      continue;
    }

    // Outside Japan the mode is meaningless and the marker would be nowhere
    // near the framed archipelago. 昭和 is the only such station today and it
    // has no 雪の初日 anyway, so this is a guard against JMA adding another.
    assertInJapan(station, "has a 雪の初日");

    const depthRow = monthly.get(MAX_DEPTH);
    const fallRow = monthly.get(SNOWFALL_TOTAL);
    const depth = cell(depthRow, ANNUAL);
    const fall = cell(fallRow, ANNUAL);

    const peak = peakDepthDoy(depthRow, start);
    // Half-way through the announced window, for the Pacific-side stations
    // where snow falls but never lies. The window is what is measured there;
    // inventing a peak month from no depth data would be worse than centring.
    const span = (end < start ? end + 365 : end) - start;
    const peakDoy = peak ?? ((Math.round(start + span / 2) - 1) % 365) + 1;

    const properties = {
      name: station.name,
      nameEn: station.nameEn,
      alt: station.alt,
      yukiHatsu: start,
      yukiShu: end,
      yukiSpan: round1(span),
      sekisetsuPeak: peakDoy,
      sekisetsuPeakMeasured: peak !== null,
      // 最深積雪 is the field that carries the finding: complete for every
      // snow station, and its 日本海側/太平洋側 contrast is the sharpest in the
      // archive (青森 101 cm against 静岡 0).
      saishinSekisetsu: Number.isFinite(depth) ? depth : 0,
      // Kept for the record, and deliberately not used to size or weight
      // anything: JMA publishes no 降雪の深さ normal at a dozen stations that do
      // publish 最深積雪 — 富士山 among them, at 0 cm of snowfall and 214 cm of
      // lying snow — so weighting on it would punch holes in the map.
      kousetsu: Number.isFinite(fall) ? fall : 0,
      // The normals window is *not* 1991–2020 everywhere: 90 of the 142 snow
      // stations were relocated during the period and JMA restarts the window
      // at the move, some as late as 2012. Carried per station rather than
      // averaged away, so a thin normal is visible as a thin normal.
      yukiHatsu_n: cell(startRow, 3),
      yukiHatsu_from: cell(startRow, 4),
      yukiHatsu_to: cell(startRow, 5),
      // JMA's 準正常値 flag. Four stations carry it — 富士山, 阿蘇山, 館野, 舞鶴.
      yukiHatsu_provisional: startRow[7]?.trim() !== "8",
    };

    if (seen.has(station.name)) {
      fail(`duplicate station name ${station.name} in the surface index`);
    }
    seen.set(station.name, properties);

    features.push({
      type: "Feature",
      geometry: { type: "Point", coordinates: [degrees(station.lng), degrees(station.lat)] },
      properties,
    });
  }

  /* --- assertions ------------------------------------------------------- */

  const missing = NO_SNOW.filter((name) => !withoutSnow.includes(name));
  const unexpected = withoutSnow.filter((name) => !NO_SNOW.includes(name));
  if (missing.length || unexpected.length) {
    fail(
      "the set of stations without 雪の初日 has drifted from NO_SNOW: " +
        `missing ${missing.join(" ") || "none"}; ` +
        `unexpected ${unexpected.join(" ") || "none"}`,
    );
  }

  for (const [name, expected] of Object.entries(EXPECTED_SNOW)) {
    const found = seen.get(name);
    if (!found) fail(`${name} has no 雪 window; the parse or the roster changed`);
    const start = monthDayToDoy(expected.start[0], expected.start[1]);
    const end = monthDayToDoy(expected.end[0], expected.end[1]);
    if (found.yukiHatsu !== start || found.yukiShu !== end) {
      fail(
        `${name} 雪 window is ${found.yukiHatsu}–${found.yukiShu}, ` +
          `expected ${start}–${end} (${expected.start.join("/")} to ${expected.end.join("/")})`,
      );
    }
    if (found.saishinSekisetsu !== expected.depth) {
      fail(
        `${name} 最深積雪 is ${found.saishinSekisetsu} cm, expected ${expected.depth} — ` +
          `element code ${MAX_DEPTH} is probably not 最深積雪 any more`,
      );
    }
  }

  // The finding, as an invariant. 金沢 and 東京 are a degree of latitude apart
  // and 金沢 gets nineteen times the snowfall, because the winter monsoon
  // crosses the Sea of Japan and unloads on the windward side of the spine. If
  // this ever stops being true of the parsed data, the parse is wrong.
  const kanazawa = seen.get("金沢");
  const tokyo = seen.get("東京");
  const ratio = kanazawa.kousetsu / Math.max(tokyo.kousetsu, 1);
  if (ratio < 15) {
    fail(
      `金沢 (${kanazawa.kousetsu} cm) is only ${round1(ratio)}× 東京 ` +
        `(${tokyo.kousetsu} cm); expected at least 15×`,
    );
  }

  const wrapping = features.filter(
    (f) => f.properties.yukiShu < f.properties.yukiHatsu,
  );
  if (wrapping.length === 0) {
    fail("no station's 雪 season crosses the new year, which cannot be right");
  }

  features.sort((a, b) =>
    a.properties.name.localeCompare(b.properties.name, "ja"),
  );

  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(
    OUT,
    JSON.stringify(
      {
        type: "FeatureCollection",
        metadata: {
          source: "気象庁 地上気象観測平年値 (1991–2020)",
          sourceUrl: "https://www.data.jma.go.jp/stats/data/mdrr/normal/index.html",
          archive: NORMALS,
          elements: {
            yukiHatsu: "季節現象 7300 雪の初日",
            yukiShu: "季節現象 7400 雪の終日",
            saishinSekisetsu: "月別 6200 最深積雪 年値 (cm)",
            kousetsu: "月別 6000 降雪の深さ合計 年値 (cm)",
          },
          stationsWithoutSnow: withoutSnow,
          note:
            "1991–2020 normals, but the window is shorter at stations relocated " +
            "during the period — see yukiHatsu_from/_to per feature. There is no " +
            "then-vs-now shift for 雪 the way there is for 桜 and 梅雨: this archive " +
            "publishes one normals window, not a per-year series. 昭和 (Syowa, " +
            "Antarctica) is in JMA's surface network and is excluded.",
        },
        features,
      },
      null,
      1,
    ),
  );

  console.log(`\nwrote ${features.length} snow stations -> ${OUT}`);
  console.log(`without 雪: ${withoutSnow.length} — ${withoutSnow.join(" ")}`);
  console.log(
    `金沢 ${kanazawa.kousetsu} cm 降雪 / ${kanazawa.saishinSekisetsu} cm 最深 vs ` +
      `東京 ${tokyo.kousetsu} / ${tokyo.saishinSekisetsu} — ${round1(ratio)}×`,
  );
  console.log(`seasons crossing the new year: ${wrapping.length}`);
}

await main();
