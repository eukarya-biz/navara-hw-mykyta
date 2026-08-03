/**
 * The 地上気象観測平年値 archive, shared by the two builds that read it.
 *
 * This is a second shared module beside jma.mjs and deliberately not part of it:
 * jma.mjs holds the things every JMA pipeline needs (the calendar, the era
 * arithmetic, the Shift_JIS fetch), while everything here is specific to one
 * 21 MB zip of per-station CSVs. build-phenology.mjs and build-tsuyu.mjs read
 * plain CSVs off the web and touch none of it.
 *
 * The archive is *code-keyed*, not header-keyed: every row is
 * `type, block_no, element_code, years, from, to, value, flag, …`, and there is
 * no label anywhere saying which code is which element. So the codes live in the
 * build scripts next to the reference values that pin them down, and this module
 * only knows how to get the bytes and cut them into rows.
 */
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { parseCsv, squeeze } from "./jma.mjs";

const run = promisify(execFile);

export const NORMALS =
  "https://www.data.jma.go.jp/stats/data/mdrr/normal/2020/data/normal_surface.zip";

/**
 * Index of the annual value in a monthly row.
 *
 * Row layout is `11, block, code, years, from, to,` then twelve `value, flag`
 * pairs for January…December, then the annual `value, flag` — so the annual
 * value sits at index 30 and January's at index 6.
 */
export const ANNUAL = 30;

/** Index of a month's value in a monthly row; `month` is 1–12. */
export const monthIndex = (month) => 6 + 2 * (month - 1);

/**
 * Everything in the surface network is inside this box except 昭和 — Syowa
 * Station, which is part of JMA's surface network and sits at 69°S. Both builds
 * assert against it rather than trusting the roster.
 */
export const JAPAN = { lat: [24, 46], lng: [122, 154] };

export function fail(message) {
  throw new Error(message);
}

/**
 * Downloads and unpacks the archive, returning the path to `normal_surface/`.
 *
 * Node has no zip reader, so the archive is unpacked by shelling out to `unzip`
 * — these scripts are hand-run dev tooling, so that is cheaper than a
 * dependency. Extraction is scoped to the directories actually read: the archive
 * also holds daily, 5-day, 10-day, monthly-basis and regional-average normals,
 * 1,963 files and 194 MB unpacked, and no caller needs them.
 *
 * `subdirs` names the per-station directories to unpack alongside the station
 * index — "monthly" for both callers, plus "seasonal_phenomena" for 雪.
 *
 * Set `JMA_NORMALS_ZIP` to a local copy of the archive to skip the download:
 *
 *     JMA_NORMALS_ZIP=~/normal_surface.zip node scripts/build-heat.mjs
 *
 * Two scripts read this archive and tuning either one means running it several
 * times, which is 21 MB off JMA's servers each time for bytes that have not
 * changed since 2025-03-13. Opt-in rather than a silent cache, because a stale
 * archive is exactly the sort of thing that would make a data build quietly
 * wrong — if you point this at a file, you are asserting it is the right file.
 */
export async function fetchNormals(subdirs) {
  const dir = await mkdtemp(join(tmpdir(), "jma-normals-"));
  const local = process.env.JMA_NORMALS_ZIP;
  const zip = local || join(dir, "normal_surface.zip");

  if (local) {
    console.log(`using local archive ${local} (JMA_NORMALS_ZIP)`);
  } else {
    const response = await fetch(NORMALS);
    if (!response.ok) fail(`${NORMALS} -> ${response.status}`);
    await writeFile(zip, Buffer.from(await response.arrayBuffer()));
  }

  await run("unzip", [
    "-oq",
    zip,
    "normal_surface/surface_station_index.csv",
    ...subdirs.map((name) => `normal_surface/${name}/*`),
    "-d",
    dir,
  ]);
  return join(dir, "normal_surface");
}

/**
 * The roster, from the archive's own index.
 *
 * Coordinates come from here rather than from the AMeDAS join
 * build-phenology.mjs needs: these are 気象官署, and the index carries degrees,
 * minutes and elevation for every one of them, so there is no name matching to
 * get wrong.
 */
export async function readStationIndex(base) {
  const text = new TextDecoder("shift_jis").decode(
    await readFile(join(base, "surface_station_index.csv")),
  );
  const stations = [];
  for (const cells of parseCsv(text)) {
    const block = cells[0]?.trim();
    // Two header rows precede the data; station rows start with a block number.
    if (!/^\d+$/.test(block ?? "")) continue;
    const name = squeeze(cells[1]);
    // Columns: block, 漢字, カナ, English, lat°, lat′, lng°, lng′, altitude.
    const nameEn = squeeze(cells[3]);
    const lat = Number(cells[4]) + Number(cells[5]) / 60;
    const lng = Number(cells[6]) + Number(cells[7]) / 60;
    if (!name || !Number.isFinite(lat) || !Number.isFinite(lng)) {
      fail(`unreadable station index row: ${cells.slice(0, 9).join(",")}`);
    }
    stations.push({ block, name, nameEn, lat, lng, alt: Number(cells[8]) });
  }
  return stations;
}

/** Reads a code-keyed CSV into `Map<elementCode, cells[]>`, first row wins. */
export async function readCoded(path) {
  const text = new TextDecoder("shift_jis").decode(await readFile(path));
  const byCode = new Map();
  for (const cells of parseCsv(text)) {
    const code = cells[2]?.trim();
    if (!code || byCode.has(code)) continue;
    byCode.set(code, cells);
  }
  return byCode;
}

/** `monthly/nml_sfc_m_<block>.csv`, by element code. */
export const readMonthly = (base, block) =>
  readCoded(join(base, "monthly", `nml_sfc_m_${block}.csv`));

/** `seasonal_phenomena/nml_sfc_sph_<block>.csv`, by element code. */
export const readSeasonal = (base, block) =>
  readCoded(join(base, "seasonal_phenomena", `nml_sfc_sph_${block}.csv`));

export const cell = (cells, index) =>
  Number.parseInt(cells?.[index]?.trim() ?? "", 10);

/**
 * A cell the archive stores in tenths, as a real number.
 *
 * Temperatures are integers in tenths of a degree — 東京's August 日最高気温
 * normal is the string `313`. `cell` would hand back 313 and every threshold
 * downstream would be off by a factor of ten, which is the sort of mistake that
 * still produces a plausible-looking map.
 */
export const tenths = (cells, index) => {
  const raw = cell(cells, index);
  return Number.isFinite(raw) ? raw / 10 : null;
};

/** Degrees-and-minutes converted to five decimal places — about a metre. */
export const degrees = (value) => Math.round(value * 1e5) / 1e5;

/** Throws unless the station is inside {@link JAPAN}. */
export function assertInJapan(station, why) {
  if (
    station.lat < JAPAN.lat[0] ||
    station.lat > JAPAN.lat[1] ||
    station.lng < JAPAN.lng[0] ||
    station.lng > JAPAN.lng[1]
  ) {
    const lat = Math.round(station.lat * 10) / 10;
    const lng = Math.round(station.lng * 10) / 10;
    fail(`${station.name} ${why} but sits at ${lat}N ${lng}E, outside Japan`);
  }
}
