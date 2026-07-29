import ThreeView, { Color } from "@navaramap/three";
import {
  DefaultPlugin,
  type DefaultDescriptions,
} from "@navaramap/three-default-plugin";
import "./ui.css";
import { addJapanTerrain } from "./terrain";
import { addSeasonGlow } from "./glow";
import { MODES } from "./modes";
import { loadPhenology } from "./phenology";
import { addStations } from "./stations";
import { addBlossoms } from "./blossoms";
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

// All three fronts on by default: they peak at different times of year, so
// showing them together is what makes the opposing directions legible.
const selected = new Set(MODES.map((mode) => mode.id));
let day = 60;
let playing = true;

const phenology = await loadPhenology();
const stations = addStations(view, phenology, selected);

// The modes carrying a `blossom` style get instanced 3D geometry; stations.ts
// has already skipped their sprite layers.
const blossoms = MODES.filter((mode) => mode.blossom).map((mode) => ({
  mode,
  handle: addBlossoms(view, {
    mode,
    stations: phenology.stations,
    exaggeration: EXAGGERATION,
  }),
}));

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
  for (const { mode, handle } of blossoms) {
    handle.setDay(day, selected.has(mode.id));
  }

  syncSun(day);
  ui.render({
    day,
    selected,
    playing,
    series: MODES.map((mode) => ({
      mode,
      active: stations.activeCount(mode),
      total: stations.totalCount(mode),
      profile: stations.profile(mode),
    })),
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

// ~24 s for a full year at 60fps.
const DAYS_PER_MS = 365 / 24_000;
let last = performance.now();

function tick(now: number) {
  const elapsed = now - last;
  last = now;
  if (playing) {
    day += elapsed * DAYS_PER_MS;
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
  terrain,
  scene,
  glow,
});
