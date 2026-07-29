import ThreeView, { Color } from "@navaramap/three";
import {
  DefaultPlugin,
  type DefaultDescriptions,
} from "@navaramap/three-default-plugin";
import "./ui.css";
import { addJapanTerrain } from "./terrain";
import { MODES } from "./modes";
import { addStations } from "./stations";
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

defaultPlugin.addDefaultPhotorealScene();

// globe.color tints the whole surface, not just the sea — hillshade blends over
// it — so a dark value drags the land down with it. A mid slate reads as water
// while leaving the shaded relief legible.
view.globe.color = new Color().setStyle("#8fa8c4");

// Geometry exaggeration stays low: past ~3x the DEM's high-frequency noise turns
// into vertical needles that look nothing like Japan, especially when zoomed in.
// Legibility at archipelago scale comes from the hillshade instead, which can be
// pushed hard without deforming anything.
addJapanTerrain(view, {
  exaggeration: 2.5,
  hillshadeExaggeration: 6,
  basemap: true,
  basemapOpacity: 0.28,
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

// All three fronts on by default: they peak at different times of year, so
// showing them together is what makes the opposing directions legible.
const selected = new Set(MODES.map((mode) => mode.id));
let day = 60;
let playing = true;

const stations = await addStations(view, selected);
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

Object.assign(window as unknown as Record<string, unknown>, { view, Color });
