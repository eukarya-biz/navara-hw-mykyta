import ThreeView, { Color } from "@navaramap/three";
import {
  DefaultPlugin,
  type DefaultDescriptions,
} from "@navaramap/three-default-plugin";
import "./ui.css";
import { addJapanTerrain } from "./terrain";
import { addSeasonGlow } from "./glow";
import { MODES, type Mode } from "./modes";
import { loadPhenology, type SeasonIndex } from "./phenology";
import { addStations } from "./stations";
import { addBlossoms } from "./blossoms";
import { addTsuyu, loadTsuyu, tsuyuDeck } from "./tsuyu";
import { addSnowfall, loadSnow, snowDeck } from "./snow";
import { addWeather } from "./weather";
import { createUi } from "./ui";

const container = document.getElementById("main")!;

const view = new ThreeView<DefaultDescriptions>({
  container,
  shadow: true,
  animation: true,
});

const defaultPlugin = new DefaultPlugin();
view.addPlugin(defaultPlugin);

await view.init();

const scene = defaultPlugin.addDefaultPhotorealScene();

/**
 * Terrain geometry exaggeration. Stays low: past ~3x the DEM's high-frequency
 * noise turns into vertical needles that look nothing like Japan. Legibility at
 * archipelago scale comes from the hillshade instead, which can be pushed hard
 * without deforming anything.
 *
 * Hoisted because the blossoms sit on the same exaggerated surface and so must
 * scale station elevations by the identical factor.
 */
const EXAGGERATION = 2.5;

// globe.color is only visible where the basemap isn't. That used to be most of
// the planet — 淡色地図 covers Japan alone — which is why this was a mid slate
// that read as water. CARTO covers the whole globe, so this is now just the
// colour of the gaps, and a near-black keeps the horizon from glowing.
view.globe.color = new Color().setStyle("#101720");

// Going dark crushes the sunlit relief; a little extra exposure brings the
// hillshade back without lifting the basemap off its blacks. Kept modest — the
// atmosphere's inscatter brightens with it, and past ~1.2 the haze starts eating
// the highlight it is supposed to be lighting.
view.toneMappingExposure = 1.1;

const terrain = addJapanTerrain(view, {
  exaggeration: EXAGGERATION,
  // Pushed from 6: the relief now has to carry the terrain read on its own,
  // since the basemap below it is almost black.
  hillshadeExaggeration: 8,
  basemap: true,
  basemapOpacity: 0.85,
  // The whole piece is about Japan, so Japan should not look like its
  // neighbours. GSI's Japan-only tiles do the masking for us.
  highlight: true,
});

// Fixed oblique view of the archipelago. The camera never moves; the data does.
// Framed on Kyushu→Hokkaido: pulling back far enough to also hold the Ryukyus
// shrinks the main islands to the point where the front stops reading.
view.setCamera({
  lng: 137.2,
  lat: 28.8,
  height: 1_620_000,
  heading: 11,
  pitch: -58,
  roll: 0,
});

// Before the station layers: their materials bake `effectIds` into a bitmask at
// build time, so the bloom slot has to exist first or the markers never glow.
const glow = addSeasonGlow(view);

// All five fronts on by default: they occupy different parts of the year, so
// showing them together is what makes the opposing directions legible — and 梅雨
// sits in the one gap between spring and autumn, which is what makes the timeline
// graph cover the whole year rather than two humps with a hole in the middle. 雪
// then closes the loop by running off both ends of it.
const selected = new Set(MODES.map((mode) => mode.id));
let day = 60;
let playing = true;

const phenology = await loadPhenology();
const tsuyu = await loadTsuyu(phenology);
const snow = await loadSnow();
const stations = addStations(view, phenology, selected);

const tsuyuMode = MODES.find((mode) => mode.tsuyu)!;
const snowMode = MODES.find((mode) => mode.snow)!;

/**
 * Which station roster a mode's markers are placed on.
 *
 * 雪 is read at the 気象官署 and the other three at the 生物季節観測 stations, which
 * are a different and smaller set — so this is not one list with more columns on
 * it, and `addBlossoms` taking its stations as an argument is what makes that
 * free.
 */
const rosterFor = (mode: Mode) =>
  mode.snow ? snow.stations : phenology.stations;

// The modes carrying a `blossom` style get instanced 3D geometry; stations.ts
// has already skipped their sprite layers. 雪 also passes a weight, because its
// source measures an amount as well as a date.
const blossoms = MODES.filter((mode) => mode.blossom).map((mode) => ({
  mode,
  handle: addBlossoms(view, {
    mode,
    stations: rosterFor(mode),
    exaggeration: EXAGGERATION,
    weightOf: mode.snow ? (station) => snow.depthWeight(station) : undefined,
  }),
}));

// After the blossoms, so the `blossoms` descriptor key is already registered and
// the bloom slot already exists.
//
// One cloud pass for both weather seasons — `CloudsEffectDesc` allows no
// duplicate — so both decks have to be declared here, before it is built: its
// layer roster and their coverage windows are constructor-only.
const weather = addWeather(view, [
  tsuyuDeck({ mode: tsuyuMode, tsuyu }),
  snowDeck({ mode: snowMode, snow }),
]);
const tsuyuHandle = addTsuyu(view, { mode: tsuyuMode, tsuyu, weather });
const snowHandle = addSnowfall(view, { mode: snowMode, snow, weather });

/**
 * 梅雨 is counted in 地方, 雪 at the 気象官署 and the other three at the 生物季節
 * stations, so the tallies come from three different indexes. All three satisfy
 * `SeasonIndex`, and all three read the one clock `render` advances.
 *
 * A lookup rather than a chain of ternaries: with three of them the conditional
 * stopped being readable, and this way adding a fourth unit is a line here
 * instead of another nested branch.
 */
const indexes = new Map<string, SeasonIndex>(
  MODES.map((mode) => [
    mode.id,
    mode.regional ? tsuyu : mode.snow ? snow : stations,
  ]),
);
const indexFor = (mode: Mode): SeasonIndex => indexes.get(mode.id)!;

const ui = createUi(container);

/**
 * The sun is derived from `atmosphere.date`, so moving the clock also moves the
 * light: a low raking sun in winter, high and flat in summer. Held at 10:00 JST
 * (01:00 UTC) so only the seasonal component changes, and pinned as an explicit
 * UTC instant because `Date` would otherwise be read in the device's timezone.
 */
function syncSun(dayOfYear: number) {
  const date = new Date(Date.UTC(2026, 0, 1, 1, 0, 0));
  date.setUTCDate(date.getUTCDate() + Math.round(dayOfYear) - 1);
  view.atmosphere.date = date;
}

function render() {
  stations.setDay(day);
  snow.setDay(day);
  for (const { mode, handle } of blossoms) {
    handle.setDay(day, selected.has(mode.id));
  }
  tsuyuHandle.setDay(day, selected.has(tsuyuMode.id));
  snowHandle.setDay(day, selected.has(snowMode.id));

  syncSun(day);
  ui.render({
    day,
    selected,
    playing,
    series: MODES.map((mode) => {
      const index = indexFor(mode);
      return {
        mode,
        active: index.activeCount(mode),
        total: index.totalCount(mode),
        profile: index.profile(mode),
      };
    }),
  });
}

ui.onModeToggle((modeId) => {
  if (selected.has(modeId)) selected.delete(modeId);
  else selected.add(modeId);
  stations.setSelected(selected);
  render();
});
ui.onScrub((next) => {
  day = next;
  playing = false;
  render();
});
ui.onTogglePlay(() => {
  playing = !playing;
  render();
});

// ~24 s for a full year at 60fps, so roughly 15 days a second.
const DAYS_PER_MS = 365 / 24_000;

/**
 * The clock slows through 梅雨.
 *
 * At the uniform rate the season is 3.9 s of the loop and the two sweeps that
 * carry its motion are under a second each — the onset line crosses the framed
 * archipelago in 11 days, which is 0.7 s and about 450 screen pixels a second.
 * Everything about the deck and the lines could be right and still never be seen
 * outside of scrubbing.
 *
 * The three biological fronts take 3–4 months each, so they need no such help;
 * this is the one phenomenon whose real pace is faster than the eye at this scale.
 */
const TSUYU_HOLD = { from: 148, to: 212, scale: 0.4 };

function rateAt(dayOfYear: number) {
  const inside =
    dayOfYear >= TSUYU_HOLD.from && dayOfYear <= TSUYU_HOLD.to;
  return inside ? DAYS_PER_MS * TSUYU_HOLD.scale : DAYS_PER_MS;
}

let last = performance.now();

function tick(now: number) {
  const elapsed = now - last;
  last = now;
  if (playing) {
    day += elapsed * rateAt(day);
    if (day > 365) day -= 365;
    render();
  }
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);

render();

Object.assign(window as unknown as Record<string, unknown>, {
  view,
  Color,
  stations,
  blossoms,
  tsuyu,
  tsuyuHandle,
  snow,
  snowHandle,
  weather,
  terrain,
  scene,
  glow,
});
