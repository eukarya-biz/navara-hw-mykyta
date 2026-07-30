import type { LatLng } from "@navaramap/three";

/**
 * The geometry of the 梅雨 front and its cloud grid, with no view attached.
 *
 * Split from tsuyu.ts for the same reason blossomGeometry.ts is split from
 * blossoms.ts: everything here is arithmetic over the data, so it can be reasoned
 * about — and checked — without a globe, a WASM core or a GL context.
 */

const KM_PER_DEGREE = 111.32;

/**
 * Extent of the cloud grid, in degrees.
 *
 * The northern limit is the point of the whole feature. The Tsugaru Strait is at
 * about 41.4°N and a puff is 34 km across at full season — 0.31° of latitude — so
 * cell centres stop at 41.0 and the *visible* deck therefore stops around 41.3,
 * just short of the water. A ragged fade across Hokkaido would read as a bug; a
 * clean edge along a real channel reads as the statement it is.
 *
 * East and west run well out over the sea, because 梅雨前線 does: it is a front
 * across the Pacific that happens to cross Japan, not a Japanese phenomenon.
 */
export const GRID = {
  lat: { from: 30.0, to: 41.0, step: 0.4 },
  lng: { from: 128.5, to: 146.0, step: 0.5 },
  /**
   * How far from the nearest 梅雨-region station a cell may sit, in kilometres.
   * The 86 stations trace the archipelago closely enough to serve as a land mask,
   * so the deck follows the country without a coastline to load.
   */
  reachKm: 140,
};

/** Equirectangular distance in km — ample at this scale, and cheap. */
export function distanceKm(
  aLng: number,
  aLat: number,
  bLng: number,
  bLat: number,
) {
  const mid = ((aLat + bLat) / 2) * (Math.PI / 180);
  return Math.hypot(
    (aLng - bLng) * Math.cos(mid) * KM_PER_DEGREE,
    (aLat - bLat) * KM_PER_DEGREE,
  );
}

/** Every cell centre the grid contains, before any land or coverage test. */
export function gridCells() {
  const cells: { lng: number; lat: number }[] = [];
  // Stepped by count rather than by accumulating the step, so floating-point
  // drift cannot drop or add a final row.
  const rows = Math.floor((GRID.lat.to - GRID.lat.from) / GRID.lat.step);
  const cols = Math.floor((GRID.lng.to - GRID.lng.from) / GRID.lng.step);
  for (let r = 0; r <= rows; r += 1) {
    for (let c = 0; c <= cols; c += 1) {
      cells.push({
        lng: GRID.lng.from + c * GRID.lng.step,
        lat: GRID.lat.from + r * GRID.lat.step,
      });
    }
  }
  return cells;
}

/**
 * Longitudes the 前線 line spans, and the shape it is given.
 *
 * A real 梅雨前線 runs roughly WSW–ENE and bows northward over the Pacific, so the
 * line is tilted and bowed rather than being a parallel of latitude. Both numbers
 * are authored: this line is the *atmosphere*, interpolated between the regional
 * dates, while the deck is the data. Two different true things, and the note is
 * here so the line is never later mistaken for a measurement.
 */
export const FRONT = {
  fromLng: 128,
  toLng: 148,
  steps: 8,
  /** Degrees of latitude gained per degree of longitude — about a 9° bearing. */
  tilt: 0.16,
  /** Northward bow at mid-span, in degrees. */
  bow: 0.45,
  centreLng: 137.2,
};

/**
 * The chain of points for one line, in the form ArcLine wants.
 *
 * Two things here are load-bearing:
 *
 * - ArcLine consumes `geometry` as *pairs* — instance i spans points 2i and 2i+1 —
 *   so a polyline has to repeat every interior point.
 * - Every point is a **fresh object**. ArcLine keeps the array it was first handed
 *   and then diffs incoming points against it field by field, so handing back the
 *   same array compares it with itself, reports no change, and the line silently
 *   never moves again.
 */
export function chain(lat: number): LatLng[] {
  const { fromLng, toLng, steps, tilt, bow, centreLng } = FRONT;
  const at = (i: number) => {
    const lng = fromLng + ((toLng - fromLng) * i) / steps;
    const t = (lng - fromLng) / (toLng - fromLng);
    return {
      lng,
      lat: lat + tilt * (lng - centreLng) + bow * Math.sin(t * Math.PI),
    };
  };

  const points: LatLng[] = [];
  for (let i = 0; i < steps; i += 1) {
    points.push(at(i), at(i + 1));
  }
  return points;
}

/**
 * Inverts a set of (day, latitude) readings into latitude as a function of day.
 *
 * Onset is not monotone in latitude — 北陸 at 37.9°N starts on day 162 while
 * 関東甲信 at 35.7°N starts on 158, because the Sea-of-Japan side runs late — so a
 * plain sort would make the line jump backwards. Taking a running maximum turns
 * the readings into the monotone advance the line depicts. The deck, keyed per
 * region, keeps the real non-monotone order.
 *
 * Returns null outside the span, which is how the line knows to hide: before the
 * first region turns on and after the last one has, there is no front to draw.
 */
export function latitudeByDay(samples: { day: number; lat: number }[]) {
  const sorted = [...samples].sort((a, b) => a.day - b.day);
  let highest = -Infinity;
  const rising = sorted.map(({ day, lat }) => {
    highest = Math.max(highest, lat);
    return { day, lat: highest };
  });
  const last = rising[rising.length - 1];

  return (day: number): number | null => {
    if (day < rising[0].day || day > last.day) return null;
    for (let i = 1; i < rising.length; i += 1) {
      if (day > rising[i].day) continue;
      const a = rising[i - 1];
      const b = rising[i];
      const span = b.day - a.day;
      const t = span > 0 ? (day - a.day) / span : 1;
      return a.lat + (b.lat - a.lat) * t;
    }
    return last.lat;
  };
}
