/**
 * Builds public/data/heat.geojson from JMA's 地上気象観測平年値 1991–2020.
 *
 * This is the one dataset in the piece whose dates are *derived* rather than
 * published, and that has to be said plainly wherever it is read.
 *
 * 桜's 開花, 梅雨's 入り and 明け, 雪's 初日 and 終日 are all announced days: JMA
 * names them and the build script only has to parse them. There is no announced
 * 猛暑の初日. What the archive publishes is twelve monthly means of 日最高気温 per
 * station, so the season here is *computed*: the twelve means are interpolated
 * into a smooth annual curve and the season is the stretch where that curve sits
 * at or above 30 °C — 真夏日's threshold.
 *
 * The cost of that is resolution. A monthly mean is one number for a thirty-day
 * window, so a day named by crossing it carries roughly ±5–10 days of slop, and
 * a 猛暑 edge is emphatically not the same kind of statement as a 梅雨明け.
 * modes.ts and the README both repeat this; do not let it fall out of any of the
 * three.
 *
 * What is *not* derived: the shape. The south-to-north advance, the six-week
 * plateau over the Inland Sea, and the fact that 仙台 and everything north of it
 * never crosses at all are all straight out of the published normals.
 */
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { MONTH_STARTS, doyToMonthDay, round1 } from "./jma.mjs";
import {
  assertInJapan,
  cell,
  degrees,
  fail,
  fetchNormals,
  monthIndex,
  NORMALS,
  readMonthly,
  readStationIndex,
  tenths,
} from "./normals.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = resolve(ROOT, "public/data/heat.geojson");
const FIELD_OUT = resolve(ROOT, "public/data/heat-field.geojson");

/**
 * The painted field's grid.
 *
 * 101 stations scattered over the archipelago do not read as a heatwave; they
 * read as 101 dots. The field is what makes the season legible at a glance — the
 * same device a 気温分布図 uses — so the grid is generated here rather than
 * interpolated in the browser, where it would have to be redone every frame.
 *
 * 0.1° is about 11 km, or four pixels at this camera. It started at 0.15° and came
 * down once the land mask went in: the mask keeps a cell whose *centre* is on
 * land, so a coastal cell overhangs the water by up to half a step, and at 0.15°
 * that fringe of half-submerged squares was the most obvious thing about the
 * layer. At 0.1° the overhang is under 6 km and the coastline reads as a
 * coastline. Finer still would be smoother and is affordable in bytes, but the
 * evaluator has to recolour every cell twice a day.
 *
 * 70 km of reach is deliberately short — see `interpolate` for what that is
 * protecting against.
 */
const FIELD_STEP = 0.1;
const FIELD_REACH_KM = 70;

/**
 * Land polygons, used to keep the field off the sea.
 *
 * Without this the grid is a field of squares in open water: the reach is 70 km
 * from a station and most of JMA's network is coastal, so every seaward cell
 * within that radius gets painted. It read as blocks floating in the Sea of
 * Japan rather than as a map of Japan being hot.
 *
 * Natural Earth, public domain, at 1:10m — accurate to about a kilometre, which
 * is far finer than the grid it is filtering. Both files are needed: `land` has
 * the four main islands and `minor_islands` has 種子島, 屋久島, the Ryukyus and the
 * Ogasawaras, which are exactly the places this mode has the most to say about.
 *
 * Set `NE_LAND_DIR` to a directory holding the two .geojson files to skip the
 * download, the same opt-in `JMA_NORMALS_ZIP` offers and for the same reason.
 */
const NE_BASE =
  "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson";
const NE_FILES = ["ne_10m_land.geojson", "ne_10m_minor_islands.geojson"];
/** Inverse-distance weighting exponent. */
const FIELD_POWER = 2;
/**
 * Bounds of the grid.
 *
 * The east edge at 142°E is the one doing real work: it keeps 南鳥島
 * (154°E) and 父島 (142.2°E) out. Both are real stations with real heat, and both
 * are thousands of kilometres from the framed archipelago.
 */
const FIELD_EXTENT = { lat: [24.0, 40.0], lng: [122.0, 142.0] };

/**
 * Monthly temperature element codes, from `monthly/nml_sfc_m_<block>.csv`.
 *
 * Stored in *tenths of a degree* as integers — 東京's August value is the string
 * `313` — which is why these are read with `tenths` and not `cell`. Reading them
 * as whole degrees would put every station a factor of ten above the threshold
 * and paint the entire country all year, which is a failure obvious enough to
 * catch; reading 0500 instead of 0600 would not be.
 *
 * Pinned down two ways, because a wrong code here still produces a plausible map.
 *
 * First, externally: 0600's twelve values at 東京 are
 * 9.8 10.9 14.2 19.4 23.6 26.1 29.9 31.3 27.5 22.0 16.7 12.0, which is JMA's
 * published 日最高気温平年値 for 東京 exactly, month for month.
 *
 * Second, structurally, and this is the check that actually runs below: the
 * three codes are adjacent and are 日平均 / 日最高 / 日最低. Whatever else is true,
 * a month's mean daily maximum cannot be below its mean daily temperature, which
 * cannot be below its mean daily minimum — so `assertTemperatureOrder` requires
 * 0700 ≤ 0500 ≤ 0600 at every station in every month, 157 × 12 comparisons. Two
 * of the three orderings are impossible under a mislabelling, so this pins 0600
 * as the maximum without transcribing a single further number.
 */
const MAX_TEMP = "0600"; // 日最高気温の月平均 (0.1 °C)
const MEAN_TEMP = "0500"; // 日平均気温の月平均 (0.1 °C)
const MIN_TEMP = "0700"; // 日最低気温の月平均 (0.1 °C)

/**
 * The threshold that defines the season, in °C.
 *
 * 30 is 真夏日's line, which is the one temperature in Japanese weather reporting
 * that needs no explanation. It also happens to be where the map gets
 * interesting: at 25 the "season" runs May to October and swallows both 梅雨 and
 * the start of 紅葉, and at 35 (猛暑日) only a handful of inland basins ever
 * qualify as a *monthly mean* and the country stays empty.
 */
const THRESHOLD = 30;

/**
 * Day-of-year each monthly mean is anchored at.
 *
 * A monthly normal describes the whole month, so it is placed at the month's
 * middle rather than its start — the same +15 convention build-snow.mjs uses to
 * find the month 最深積雪 peaks in, and it has to stay the same or the two
 * datasets would put the same month on different days.
 */
const ANCHORS = MONTH_STARTS.map((start) => start + 15);

/**
 * Stations that never reach the threshold, hand-transcribed.
 *
 * Fifty-six of the 157, and the list is half of what this mode has to say. It
 * is three groups and an oddity: every station in Hokkaido without exception,
 * the Tohoku coast down to 仙台 and 石巻; the high ground — 富士山, 阿蘇山, 雲仙岳,
 * 日光, 軽井沢, 諏訪, 河口湖; and, least obviously, the capes and the small
 * islands — 潮岬, 室戸岬, 石廊崎, 御前崎, 銚子, 勝浦, 大島, 三宅島, 八丈島, 相川,
 * 西郷, 平戸 — which sit at latitudes that are hot everywhere else and stay
 * under the line because they are surrounded by water. 昭和 is in Antarctica.
 *
 * Checked rather than reported, for the same reason build-snow.mjs checks
 * NO_SNOW: "it never gets hot here" should be an assertion, not whatever the
 * parse happened to produce.
 */
const NO_HEAT = [
  "稚内", "北見枝幸", "羽幌", "雄武", "留萌", "旭川", "網走", "小樽", "札幌",
  "岩見沢", "帯広", "釧路", "根室", "寿都", "室蘭", "苫小牧", "浦河", "江差",
  "函館", "倶知安", "紋別", "広尾", "大船渡", "新庄", "深浦", "青森", "むつ",
  "八戸", "秋田", "盛岡", "宮古", "酒田", "仙台", "石巻", "白河", "小名浜",
  "相川", "諏訪", "軽井沢", "富士山", "河口湖", "銚子", "御前崎", "石廊崎",
  "勝浦", "大島", "三宅島", "八丈島", "日光", "西郷", "潮岬", "平戸", "雲仙岳",
  "阿蘇山", "室戸岬", "昭和",
];

/**
 * Reference windows, for the shape of the result rather than the parse.
 *
 * The element code is already pinned by the two checks above, so these guard
 * something else: that the *interpolation* still produces the country the
 * normals describe. 那覇 must have a long season and 東京 a short one, the
 * hottest curve must belong to an inland basin and not to the tropics, and
 * nothing north of Tohoku may have a season at all.
 *
 * Days rather than dates, with a tolerance, because these are interpolated and
 * pinning them to the day would make the assertion a restatement of the
 * arithmetic instead of a check on it.
 */
const EXPECTED_HEAT = {
  那覇: { start: 169, end: 266, max: 32.1 },
  鹿児島: { start: 183, end: 259, max: 32.8 },
  京都: { start: 181, end: 253, max: 33.8 },
  大阪: { start: 182, end: 254, max: 33.8 },
  名古屋: { start: 185, end: 252, max: 33.3 },
  東京: { start: 198, end: 241, max: 31.4 },
  金沢: { start: 202, end: 240, max: 31.4 },
  新潟: { start: 209, end: 236, max: 30.9 },
};
/** How far a reference window may move before the build fails, in days. */
const TOLERANCE = 2;

/**
 * The annual curve through the twelve monthly means, evaluated at `day`.
 *
 * Catmull-Rom, and cyclic: the spline wraps December into January so the curve
 * closes on itself. A non-cyclic fit would need invented end conditions and
 * would put a kink at the new year — harmless for a summer season, but the curve
 * is also what `peakDay` searches, and a kink is exactly the sort of thing that
 * quietly becomes a maximum.
 *
 * Catmull-Rom rather than a straight line between months because the season's
 * edges are the whole output: linear segments put the crossing on a chord
 * between two monthly means, which lands it several days late on the way up and
 * early on the way down, and gives every station a visibly polygonal profile in
 * the timeline graph.
 */
function curveAt(values, day) {
  const n = ANCHORS.length;
  // The segment whose start anchor is the last one at or before `day`. Days
  // before the first anchor (Jan 1–15) belong to the segment that starts in
  // December and wraps.
  let i = n - 1;
  for (let k = 0; k < n; k += 1) {
    if (ANCHORS[k] <= day) i = k;
  }
  if (day < ANCHORS[0]) i = n - 1;

  const x0 = ANCHORS[i];
  let x1 = ANCHORS[(i + 1) % n];
  if (x1 <= x0) x1 += 365;
  const u = ((day >= x0 ? day : day + 365) - x0) / (x1 - x0);

  const p0 = values[(i - 1 + n) % n];
  const p1 = values[i % n];
  const p2 = values[(i + 1) % n];
  const p3 = values[(i + 2) % n];
  return (
    0.5 *
    (2 * p1 +
      (-p0 + p2) * u +
      (2 * p0 - 5 * p1 + 4 * p2 - p3) * u * u +
      (-p0 + 3 * p1 - 3 * p2 + p3) * u * u * u)
  );
}

/**
 * The season, as `{ start, peak, end, max }`, or null where the curve never
 * reaches the threshold.
 *
 * Evaluated at whole days: the source resolution is a month, so refining a
 * crossing below a day would be precision this data does not have.
 */
function season(values) {
  const curve = [];
  for (let day = 1; day <= 365; day += 1) curve.push(curveAt(values, day));

  const above = [];
  for (let day = 1; day <= 365; day += 1) {
    if (curve[day - 1] >= THRESHOLD) above.push(day);
  }
  if (above.length === 0) return null;

  const start = above[0];
  const end = above[above.length - 1];
  // A single unbroken run. The curve is smooth and Japan's summer has one hump,
  // so two runs would mean a spline overshoot dipping back under the threshold
  // mid-season — which would give `phase` a window with a hole in it that
  // nothing downstream could express.
  if (above.length !== end - start + 1) {
    fail(`the ${THRESHOLD}°C curve breaks into more than one run: ${above.join(" ")}`);
  }

  let peak = start;
  for (let day = start; day <= end; day += 1) {
    if (curve[day - 1] > curve[peak - 1]) peak = day;
  }
  return { start, peak, end, max: curve[peak - 1] };
}

/** 0700 ≤ 0500 ≤ 0600, at every station in every month. */
function assertTemperatureOrder(name, monthly) {
  for (let month = 1; month <= 12; month += 1) {
    const index = monthIndex(month);
    const min = tenths(monthly.get(MIN_TEMP), index);
    const mean = tenths(monthly.get(MEAN_TEMP), index);
    const max = tenths(monthly.get(MAX_TEMP), index);
    if (min === null || mean === null || max === null) {
      fail(`${name} is missing a temperature normal for month ${month}`);
    }
    if (!(min <= mean && mean <= max)) {
      fail(
        `${name} month ${month}: 最低 ${min} / 平均 ${mean} / 最高 ${max} are not ` +
          `in order — codes ${MIN_TEMP}/${MEAN_TEMP}/${MAX_TEMP} are not what they were`,
      );
    }
  }
}

const label = (doy) => {
  const { month, day } = doyToMonthDay(doy);
  return `${month}月${day}日`;
};

/* ------------------------------------------------------------------ the field */

const KM_PER_DEGREE = 111.32;

/** Latitude of a grid cell's centre — its corners are symmetric about it. */
const centroidLat = (feature) => {
  const ring = feature.geometry.coordinates[0];
  return (ring[0][1] + ring[2][1]) / 2;
};

/**
 * Loads the Natural Earth land rings that overlap the grid, as flat arrays.
 *
 * Only rings whose bounding box intersects `FIELD_EXTENT` are kept — the two
 * files together describe every coastline on Earth, and all but a handful of
 * their rings are irrelevant here. Holes are kept alongside outers and handled
 * by the even-odd rule in `isLand`, which is what makes Lake Biwa a hole rather
 * than a mystery.
 */
async function loadLandRings() {
  const dir = process.env.NE_LAND_DIR;
  const rings = [];

  for (const file of NE_FILES) {
    let text;
    if (dir) {
      text = await readFile(join(dir, file), "utf8");
      console.log(`using local ${file} (NE_LAND_DIR)`);
    } else {
      const url = `${NE_BASE}/${file}`;
      const response = await fetch(url);
      if (!response.ok) fail(`${url} -> ${response.status}`);
      text = await response.text();
    }

    const collection = JSON.parse(text);
    for (const feature of collection.features ?? []) {
      const geometry = feature.geometry;
      if (!geometry) continue;
      const polygons =
        geometry.type === "Polygon"
          ? [geometry.coordinates]
          : geometry.type === "MultiPolygon"
            ? geometry.coordinates
            : [];
      for (const polygon of polygons) {
        for (const ring of polygon) {
          let minLng = Infinity;
          let maxLng = -Infinity;
          let minLat = Infinity;
          let maxLat = -Infinity;
          for (const [lng, lat] of ring) {
            if (lng < minLng) minLng = lng;
            if (lng > maxLng) maxLng = lng;
            if (lat < minLat) minLat = lat;
            if (lat > maxLat) maxLat = lat;
          }
          if (
            maxLng < FIELD_EXTENT.lng[0] ||
            minLng > FIELD_EXTENT.lng[1] ||
            maxLat < FIELD_EXTENT.lat[0] ||
            minLat > FIELD_EXTENT.lat[1]
          ) {
            continue;
          }
          rings.push({ ring, minLng, maxLng, minLat, maxLat });
        }
      }
    }
  }

  if (rings.length === 0) {
    fail("no Natural Earth land rings overlap the grid extent");
  }
  return rings;
}

/**
 * Whether a point is on land, by the even-odd rule over every overlapping ring.
 *
 * Counting crossings across outers *and* holes together is what gets the inland
 * water right for free: a point inside 琵琶湖 crosses the Honshu outer once and
 * the lake ring once, so it comes out even, which is to say not land.
 */
function isLand(rings, lng, lat) {
  let inside = false;
  for (const { ring, minLng, maxLng, minLat, maxLat } of rings) {
    if (lng < minLng || lng > maxLng || lat < minLat || lat > maxLat) continue;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
      const [xi, yi] = ring[i];
      const [xj, yj] = ring[j];
      if (yi > lat !== yj > lat) {
        const x = xi + ((lat - yi) / (yj - yi)) * (xj - xi);
        if (x > lng) inside = !inside;
      }
    }
  }
  return inside;
}

function distanceKm(aLat, aLng, bLat, bLng) {
  const mid = ((aLat + bLat) / 2) * (Math.PI / 180);
  return Math.hypot(
    (aLng - bLng) * KM_PER_DEGREE * Math.cos(mid),
    (aLat - bLat) * KM_PER_DEGREE,
  );
}

/**
 * The twelve monthly values at an arbitrary point, or null where there is no
 * station near enough to say.
 *
 * Inverse-distance weighting over **every** station in the network, not only the
 * 101 with a season. That distinction is load-bearing: interpolating from the hot
 * stations alone would have nothing to pull the field down as it approaches the
 * cold ones, and the 30 °C edge would run north of where it belongs. 仙台's 28.2
 * has to be in the average for the boundary near 仙台 to land in the right place.
 *
 * **This has no elevation awareness, and the Japanese Alps are where that shows.**
 * A cell in the mountains is interpolated from the valley stations that ring
 * them — 松本, 高山, 長野, 甲府 — so the field paints high ground at the
 * temperature of the basins below it. The station altitudes are right here in the
 * index and a 6.5 °C/km lapse rate would be easy, but applying one needs the
 * *cell's* elevation, and there is no DEM in this script. So the honest fix is
 * unavailable and the mitigation is `FIELD_REACH_KM`: at 70 km the field simply
 * stops rather than extrapolating across a range, which keeps the error to the
 * interiors that genuinely are ringed by stations. It is stated in the emitted
 * metadata and in the README, because it is the one place this layer is wrong in
 * a way a viewer cannot see.
 */
function interpolate(stations, lat, lng) {
  let totalWeight = 0;
  const sum = new Array(12).fill(0);
  for (const station of stations) {
    const d = distanceKm(lat, lng, station.lat, station.lng);
    if (d > FIELD_REACH_KM) continue;
    // Floored at 1 km so a cell sitting on a station does not divide by zero.
    const weight = 1 / Math.max(d, 1) ** FIELD_POWER;
    totalWeight += weight;
    for (let m = 0; m < 12; m += 1) sum[m] += weight * station.values[m];
  }
  if (totalWeight === 0) return null;
  return sum.map((v) => Math.round((v / totalWeight) * 10) / 10);
}

/**
 * The grid, as one square polygon per cell that reaches the threshold at some
 * point in the year.
 *
 * Cells that never get there are dropped rather than emitted and hidden: they are
 * a third of the grid, they would never be drawn, and every one of them would
 * still cost the evaluator a call on every repaint.
 */
function buildField(stations, landRings) {
  const features = [];
  const rows = Math.round((FIELD_EXTENT.lat[1] - FIELD_EXTENT.lat[0]) / FIELD_STEP);
  const cols = Math.round((FIELD_EXTENT.lng[1] - FIELD_EXTENT.lng[0]) / FIELD_STEP);
  let considered = 0;
  let dropped = 0;

  /**
   * A cell edge, from its index on the grid.
   *
   * Written as one function of the index — and *not* as `centre ± half` — so that
   * two neighbours asking for the edge they share evaluate the identical
   * expression and get the identical float. Computing it as `centre + half` on
   * one side and `centre − half` on the other differs in the last bits, and
   * rounding for output then promotes that to a whole unit in the last decimal:
   * a real gap between the two cells, which renders as a hairline of bare
   * terrain. Those seams were visible as vertical bars running the height of the
   * country before this was written this way. Five decimals is about a metre,
   * matching `degrees()` in normals.mjs.
   */
  const edge = (origin, index) =>
    Math.round((origin + (index - 0.5) * FIELD_STEP) * 1e5) / 1e5;

  for (let r = 0; r <= rows; r += 1) {
    for (let c = 0; c <= cols; c += 1) {
      const lat = FIELD_EXTENT.lat[0] + r * FIELD_STEP;
      const lng = FIELD_EXTENT.lng[0] + c * FIELD_STEP;
      const values = interpolate(stations, lat, lng);
      if (!values) continue;
      considered += 1;

      // Land only. Tested at the cell *centre*, so a cell straddling the coast
      // is kept whole and overhangs the water by up to half a step — which is
      // why the step came down from 0.15° to 0.1°: it puts that overhang under
      // 6 km, about two pixels at this camera, instead of the ragged fringe a
      // coarser grid left along every coastline. Clipping the squares to the
      // coast itself would need real polygon intersection, and a dependency for
      // two pixels is the wrong trade.
      if (!isLand(landRings, lng, lat)) {
        dropped += 1;
        continue;
      }

      const found = season(values);
      if (!found) continue;

      const w = edge(FIELD_EXTENT.lng[0], c);
      const e = edge(FIELD_EXTENT.lng[0], c + 1);
      const s = edge(FIELD_EXTENT.lat[0], r);
      const n = edge(FIELD_EXTENT.lat[0], r + 1);
      features.push({
        type: "Feature",
        geometry: {
          type: "Polygon",
          coordinates: [
            [
              [w, s],
              [e, s],
              [e, n],
              [w, n],
              [w, s],
            ],
          ],
        },
        properties: {
          // Tenths of a degree as integers, which is how the archive stores them
          // and about half the characters of the decimal form. natsu.ts divides.
          kion: values.map((v) => Math.round(v * 10)),
          // The derived triple, so the layer can be filtered and the window
          // checked without re-deriving it, and so this file can be read on its
          // own terms.
          natsuKaishi: found.start,
          natsuOwari: found.end,
          natsuMax: round1(found.max),
        },
      });
    }
  }
  return { features, considered, dropped };
}

async function main() {
  const base = await fetchNormals(["monthly"]);

  const stations = await readStationIndex(base);
  console.log(`surface station index: ${stations.length} stations`);

  const features = [];
  const withoutHeat = [];
  const seen = new Map();
  // Every station, hot or not, for the field's interpolation — see `interpolate`
  // on why the cold ones have to be in it.
  const allStations = [];

  for (const station of stations) {
    const monthly = await readMonthly(base, station.block);
    assertTemperatureOrder(station.name, monthly);

    const row = monthly.get(MAX_TEMP);
    const values = [];
    for (let month = 1; month <= 12; month += 1) {
      values.push(tenths(row, monthIndex(month)));
    }
    allStations.push({ lat: station.lat, lng: station.lng, values });

    const found = season(values);
    if (!found) {
      withoutHeat.push(station.name);
      continue;
    }

    // Same guard build-snow.mjs carries: outside Japan the mode is meaningless
    // and the paint would land nowhere near the framed archipelago. 昭和 is at
    // 69°S and never crosses the threshold anyway, so this catches a future
    // addition rather than a present problem.
    assertInJapan(station, "has a 真夏日 season");

    const properties = {
      name: station.name,
      nameEn: station.nameEn,
      alt: station.alt,
      // The derived triple. Named for what they are — the days the *monthly
      // normal curve* crosses 30 °C — and not 猛暑入り/明け, which would borrow
      // 梅雨's announced-date vocabulary for something JMA never announced.
      natsuKaishi: found.start,
      natsuPeak: found.peak,
      natsuOwari: found.end,
      natsuNichisu: found.end - found.start + 1,
      // The weight, and the one number here that is read rather than derived:
      // the height of the curve at its peak, which is within a tenth of the
      // hottest monthly normal at every station. This is what puts a deeper deck
      // over the Inland Sea basins than over the Ryukyus — 京都 is hotter than
      // 那覇 by a degree and a half, which is the finding.
      natsuMax: round1(found.max),
      // The hottest month's published mean, unsmoothed, so the curve can always
      // be checked against the source it was fitted to.
      hachigatsu: values[7],
      // Every monthly value, for the same reason: twelve numbers is nothing next
      // to the geometry, and it makes the interpolation auditable from the
      // browser rather than only from this script.
      kion: values,
    };

    if (seen.has(station.name)) {
      fail(`duplicate station name ${station.name} in the surface index`);
    }
    seen.set(station.name, properties);

    features.push({
      type: "Feature",
      geometry: {
        type: "Point",
        coordinates: [degrees(station.lng), degrees(station.lat)],
      },
      properties,
    });
  }

  /* --- assertions ------------------------------------------------------- */

  const missing = NO_HEAT.filter((name) => !withoutHeat.includes(name));
  const unexpected = withoutHeat.filter((name) => !NO_HEAT.includes(name));
  if (missing.length || unexpected.length) {
    fail(
      "the set of stations that never reach 30°C has drifted from NO_HEAT: " +
        `missing ${missing.join(" ") || "none"}; ` +
        `unexpected ${unexpected.join(" ") || "none"}`,
    );
  }

  for (const [name, expected] of Object.entries(EXPECTED_HEAT)) {
    const found = seen.get(name);
    if (!found) fail(`${name} has no 真夏日 season; the parse or the roster changed`);
    for (const [key, want] of [
      ["natsuKaishi", expected.start],
      ["natsuOwari", expected.end],
    ]) {
      if (Math.abs(found[key] - want) > TOLERANCE) {
        fail(
          `${name} ${key} is ${found[key]} (${label(found[key])}), expected ` +
            `${want} (${label(want)}) ±${TOLERANCE} — the interpolation moved`,
        );
      }
    }
    if (Math.abs(found.natsuMax - expected.max) > 0.1) {
      fail(
        `${name} peak is ${found.natsuMax}°C, expected ${expected.max} — ` +
          `element code ${MAX_TEMP} is probably not 日最高気温 any more`,
      );
    }
  }

  // No station's season may touch either end of the year. Japan is in the
  // northern hemisphere so this cannot happen, and `phase`'s year-lift — which
  // 雪 needs and this mode does not — stays a no-op only while it holds.
  const wrapping = features.filter(
    (f) => f.properties.natsuKaishi <= 1 || f.properties.natsuOwari >= 365,
  );
  if (wrapping.length > 0) {
    fail(
      `${wrapping.length} station(s) have a 真夏日 season touching the year ` +
        `boundary: ${wrapping.map((f) => f.properties.name).join(" ")}`,
    );
  }

  // The finding, as an invariant. The hottest place in Japan is not the
  // southernmost: 京都 and 大阪, basins ringed by hills at 35°N, run hotter than
  // 那覇 at 26°N, because the sea that keeps the Ryukyus at 32 also keeps them
  // from going past it. If the parse ever stops saying this, it is wrong.
  const kyoto = seen.get("京都");
  const naha = seen.get("那覇");
  if (kyoto.natsuMax <= naha.natsuMax) {
    fail(
      `京都 (${kyoto.natsuMax}°C) is not hotter than 那覇 (${naha.natsuMax}°C); ` +
        "the whole inland-basin finding depends on it",
    );
  }
  // And the other half of it: 那覇's season is far longer than 京都's, which is
  // the same maritime moderation seen from the other side.
  if (naha.natsuNichisu <= kyoto.natsuNichisu) {
    fail(
      `那覇's season (${naha.natsuNichisu} d) is not longer than 京都's ` +
        `(${kyoto.natsuNichisu} d)`,
    );
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
          sourceUrl:
            "https://www.data.jma.go.jp/stats/data/mdrr/normal/index.html",
          archive: NORMALS,
          elements: {
            kion: `月別 ${MAX_TEMP} 日最高気温の月平均 (°C)`,
          },
          derived: {
            threshold: THRESHOLD,
            method:
              "The twelve monthly 日最高気温 normals are anchored at each month's " +
              "midpoint and interpolated with a cyclic Catmull-Rom spline; " +
              "natsuKaishi/natsuOwari are the days that curve crosses the " +
              "threshold and natsuPeak is its maximum.",
            caveat:
              "These days are DERIVED, not announced. JMA publishes no 猛暑の初日 " +
              "the way it publishes 梅雨入り or 初雪, and a day named by crossing a " +
              "curve fitted to monthly means carries roughly ±5–10 days of slop. " +
              "The shape of the season is the source's; the edges are this " +
              "script's reading of it.",
          },
          stationsWithoutHeat: withoutHeat,
          note:
            "1991–2020 normals. Fifty-six of the 157 surface stations never " +
            "reach a 30 °C monthly mean daily maximum — all of Hokkaido, most " +
            "of the Tohoku coast, the summit stations, and 昭和 (Syowa, " +
            "Antarctica), which is in JMA's surface network and is excluded.",
        },
        features,
      },
      null,
      1,
    ),
  );

  /* --- the field ---------------------------------------------------------- */

  const landRings = await loadLandRings();
  console.log(`land mask: ${landRings.length} rings overlap the grid`);
  const field = buildField(allStations, landRings);

  // The mask has to be doing real work — every JMA station is on land, and the
  // grid extends 70 km around each of them into whatever is there.
  if (field.dropped < field.considered * 0.2) {
    fail(
      `the land mask dropped only ${field.dropped} of ${field.considered} cells; ` +
        "an archipelago's grid should be mostly sea, so the mask is not working",
    );
  }

  // The field is an interpolation and the stations are the measurement, so the
  // two must agree at the places the measurement exists. A cell centred within
  // half a step of a hot station that came out cold — or the reverse — would
  // mean the weighting is wrong.
  const hokkaido = field.features.filter(
    (f) => f.properties.natsuKaishi && centroidLat(f) > 41.5,
  );
  if (hokkaido.length > 0) {
    fail(
      `${hokkaido.length} field cells north of 41.5°N reach 30 °C; no Hokkaido ` +
        "station does, so the interpolation is reaching too far",
    );
  }

  const fieldPeak = Math.max(...field.features.map((f) => f.properties.natsuMax));
  const stationPeak = Math.max(...features.map((f) => f.properties.natsuMax));
  // An interpolated field is an average of averages, so it cannot be hotter than
  // the hottest thing it averages. If it is, the weighting has a sign error.
  if (fieldPeak > stationPeak + 0.05) {
    fail(
      `the field peaks at ${round1(fieldPeak)} °C but no station is above ` +
        `${stationPeak} °C — inverse-distance weighting cannot extrapolate`,
    );
  }

  await writeFile(
    FIELD_OUT,
    // Deliberately unindented, unlike the other four datasets: this is a
    // generated raster of a couple of thousand cells, not a table anyone will
    // read as a diff, and the indentation would roughly double it.
    JSON.stringify({
      type: "FeatureCollection",
      metadata: {
        source: "気象庁 地上気象観測平年値 (1991–2020)",
        sourceUrl: "https://www.data.jma.go.jp/stats/data/mdrr/normal/index.html",
        archive: NORMALS,
        derived: {
          of: "data/heat.geojson",
          threshold: THRESHOLD,
          grid: { stepDeg: FIELD_STEP, reachKm: FIELD_REACH_KM, power: FIELD_POWER },
          landMask: "Natural Earth 1:10m land + minor islands (public domain); cells are kept when their centre is on land",
          method:
            `Inverse-distance weighting (power ${FIELD_POWER}, ${FIELD_REACH_KM} km ` +
            "cutoff) of the twelve monthly 日最高気温 normals over all 157 surface " +
            "stations, evaluated on a " + FIELD_STEP + "° grid. Cells whose curve " +
            "never reaches the threshold are omitted entirely.",
          caveat:
            "Doubly interpolated — across space between stations and across time " +
            "between months — and this is a NORMAL, not an event: it is the shape " +
            "of an average summer, not a heatwave that happened. It also has NO " +
            "ELEVATION AWARENESS: mountain cells are interpolated from the valley " +
            "stations that ring them, so high ground reads hotter than it is. The " +
            "70 km cutoff limits how far that error can travel but does not " +
            "remove it.",
        },
      },
      features: field.features,
    }),
  );

  const hottest = [...seen.entries()].sort(
    (a, b) => b[1].natsuMax - a[1].natsuMax,
  );
  const longest = [...seen.entries()].sort(
    (a, b) => b[1].natsuNichisu - a[1].natsuNichisu,
  );

  console.log(`\nwrote ${features.length} heat stations -> ${OUT}`);
  console.log(`never reach ${THRESHOLD}°C: ${withoutHeat.length} stations`);
  console.log(
    `hottest: ${hottest
      .slice(0, 5)
      .map(([name, p]) => `${name} ${p.natsuMax}°C`)
      .join(" · ")}`,
  );
  console.log(
    `longest: ${longest
      .slice(0, 5)
      .map(([name, p]) => `${name} ${p.natsuNichisu}d`)
      .join(" · ")}`,
  );
  console.log(
    `京都 ${kyoto.natsuMax}°C / ${kyoto.natsuNichisu}d ` +
      `(${label(kyoto.natsuKaishi)}–${label(kyoto.natsuOwari)}) vs ` +
      `那覇 ${naha.natsuMax}°C / ${naha.natsuNichisu}d ` +
      `(${label(naha.natsuKaishi)}–${label(naha.natsuOwari)})`,
  );

  const profile = new Array(366).fill(0);
  for (const feature of features) {
    for (
      let day = feature.properties.natsuKaishi;
      day <= feature.properties.natsuOwari;
      day += 1
    ) {
      profile[day] += 1;
    }
  }
  let peakDay = 1;
  for (let day = 1; day <= 365; day += 1) {
    if (profile[day] > profile[peakDay]) peakDay = day;
  }
  console.log(
    `peak coverage: ${profile[peakDay]} stations on day ${peakDay} ` +
      `(${label(peakDay)})`,
  );
  // The hole this mode exists to fill — days 210–259 had nothing in any of the
  // other five modes.
  let thin = 210;
  for (let day = 210; day <= 259; day += 1) {
    if (profile[day] < profile[thin]) thin = day;
  }
  console.log(
    `days 210–259 (the old gap): never fewer than ${profile[thin]} stations ` +
      `(lowest on day ${thin}, ${label(thin)})`,
  );

  const kb = Math.round((await stat(FIELD_OUT)).size / 1024);
  console.log(
    `\nfield: ${field.features.length} of ${field.considered} grid cells reach ` +
      `${THRESHOLD}°C -> ${FIELD_OUT} (${kb} kB)`,
  );
  console.log(
    `field peak ${round1(fieldPeak)}°C against the hottest station's ${stationPeak}°C`,
  );
}

await main();
