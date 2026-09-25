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
import { addNatsu, loadNatsu } from "./natsu";
import { addWeather } from "./weather";
import { createUi } from "./ui";

const container = document.getElementById("main")!;

const view = new ThreeView<DefaultDescriptions>({
  container,
  shadow: true,
  animation: true,
  // Atmosphere, cloud and noise assets ship in the bundle since Navara 0.0.5;
  // no asset URLs needed.
});

const defaultPlugin = new DefaultPlugin();
view.addPlugin(defaultPlugin);

await view.init();

const scene = defaultPlugin.addDefaultPhotorealScene();

/**
 * Terrain geometry exaggeration. Barely above true scale, and deliberately: at
 * 2.5x the DEM's high-frequency noise reads as vertical needles and the Alps
 * stand 7.5 km, which is not what Japan looks like from 1,600 km up. Legibility
 * at archipelago scale comes from the hillshade instead, which shades the same
 * relief without deforming it.
 *
 * One consequence worth knowing when looking at winter: at 1.3x the spine tops
 * out around 3.9 km rather than 7.5, so 雪's 900 m deck now sits *above* most of
 * the terrain instead of being pierced by it — which is the right relationship
 * for shallow convective cloud, and the reason the streaks read as lying over
 * the country rather than tangled in it.
 *
 * Hoisted because the blossoms sit on the same exaggerated surface and so must
 * scale station elevations by the identical factor.
 */
const EXAGGERATION = 1.3;

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
  // Was 8, which turned every DEM artefact into a bright speckle — at that
  // strength the shading stops describing slopes and starts describing the
  // tile pyramid. Four still separates windward from lee across the spine,
  // which is the one thing the relief has to do for 雪.
  hillshadeExaggeration: 4,
  basemap: true,
  basemapOpacity: 0.85,
  // The whole piece is about Japan, so Japan should not look like its
  // neighbours. GSI's Japan-only tiles do the masking for us.
  highlight: true,
});

// Fixed oblique view of the archipelago. The camera *starts* here and the data
// moves under it — nothing in the app ever re-frames it — but the viewer can,
// and code that assumed otherwise has been wrong at least once: see the march
// budget in weather.ts, which culled half the country's cloud from any camera
// low enough to look along the deck rather than down onto it.
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

// All six fronts on by default: they occupy different parts of the year, so
// showing them together is what makes the opposing directions legible.
//
// The set is now continuous, which took three tries. 桜 and the autumn pair left
// two humps with a hole between them; 梅雨 filled May to late July and 雪 closed
// the winter end, and the graph still sat flat on the axis from day 210 to 259 —
// fifty days from the end of 梅雨 to the first 初雪 with nothing in any mode, which
// is the emptiest the country ever looks and the least true. 猛暑 is those fifty
// days: it opens under 梅雨 in the south, holds through August at every station in
// the dataset, and hands over to 雪 in mid-September.
const selected = new Set(MODES.map((mode) => mode.id));

/**
 * The clock starts stopped, on 3月1日.
 *
 * Autoplay dropped the viewer into a year already under way: by the time the
 * frame they landed on had been read the date had moved off it, and the winter
 * cards already in the feed were about a season they had not watched arrive.
 * Starting the year is now the one thing the piece asks of them, and the ▶ that
 * ui.ts renders while `playing` is false is the whole of the ask.
 *
 * Day 60 is the frame it starts stopped *on*, and it is chosen to imply motion
 * rather than to summarise: the winter deck is still down over 北陸, 雪 is coming
 * off its peak at 119 of 142 stations, and 桜 has opened at exactly one. Every
 * number on screen is mid-move, and none of them is the year's answer.
 *
 * Nothing else had to change for this, because a stopped clock is exactly the
 * state ending a scrub already produces: `render()` runs once unconditionally
 * below the rAF loop, `last` is advanced outside the `playing` guard so idle
 * time cannot accumulate into a jump on the first press, and ui.ts mounts the
 * cards that are already due without animating them in.
 */
let day = 60;
let playing = false;

/**
 * Whether the viewer has touched the piece yet.
 *
 * The still frame withholds the weather. On day 60 雪 has 119 of its 142 stations
 * open, which paints a deck over very nearly the whole country — the busiest the
 * globe ever looks, arriving before the viewer has been given any reason to read
 * it, and covering the terrain and the markers that are the reason to keep
 * looking. The land, the crystals, the readout and the feed are all there on
 * load; the two volumetric decks are not.
 *
 * Any interaction ends it, not only ▶. Scrubbing to late June and finding no
 * 梅雨 over 九州 would be a bug rather than a reveal, and toggling the 雪 pill and
 * watching nothing happen would be worse — so the mode pills count too.
 *
 * It is one-way. Pausing again does not take the weather back off: by then the
 * viewer has seen the year run, and a deck that came and went with the clock
 * would read as a rendering fault rather than as an opening.
 */
let started = false;

const phenology = await loadPhenology();
const tsuyu = await loadTsuyu(phenology);
const snow = await loadSnow();
const natsu = await loadNatsu();
const stations = addStations(view, phenology, selected);

const tsuyuMode = MODES.find((mode) => mode.tsuyu)!;
const snowMode = MODES.find((mode) => mode.snow)!;
const natsuMode = MODES.find((mode) => mode.natsu)!;

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
//
// 猛暑 is not among them. It was, briefly, on the free `b` channel as 入道雲 — the
// physically correct consequence of heat over land — and from this camera a
// convective tower reads as a flat grey blob sitting on top of the field that
// was doing the explaining. It is a painted ground layer only now, which is also
// why these two get the pass to themselves again and never overlap.
const weather = addWeather(view, [
  tsuyuDeck({ mode: tsuyuMode, tsuyu }),
  snowDeck({ mode: snowMode, snow }),
]);
const tsuyuHandle = addTsuyu(view, { mode: tsuyuMode, tsuyu, weather });
const snowHandle = addSnowfall(view, { mode: snowMode, snow, weather });
const natsuHandle = addNatsu(view, { mode: natsuMode, natsu });

/**
 * 梅雨 is counted in 地方, 雪 and 猛暑 at the 気象官署 — on different subsets of
 * them — and the other three at the 生物季節 stations, so the tallies come from
 * four different indexes. All four satisfy `SeasonIndex`, and all four read the
 * one clock `render` advances.
 *
 * A lookup rather than a chain of ternaries: with three of them the conditional
 * stopped being readable, and adding the fourth was the one line it promised.
 */
const indexes = new Map<string, SeasonIndex>(
  MODES.map((mode) => [
    mode.id,
    mode.regional ? tsuyu : mode.snow ? snow : mode.natsu ? natsu : stations,
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
  natsu.setDay(day);
  for (const { mode, handle } of blossoms) {
    handle.setDay(day, selected.has(mode.id));
  }
  // `started` gates only the two cloud decks — see its note above. 猛暑 is left
  // alone deliberately: its field is painted on the terrain rather than over it,
  // and at day 60 it is 0 of 101 anyway, so gating it would be a claim with
  // nothing behind it.
  tsuyuHandle.setDay(day, started && selected.has(tsuyuMode.id));
  snowHandle.setDay(day, started && selected.has(snowMode.id));
  natsuHandle.setDay(day, selected.has(natsuMode.id));

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
  started = true;
  render();
});
ui.onScrub((next) => {
  day = next;
  playing = false;
  started = true;
  render();
});
ui.onTogglePlay(() => {
  playing = !playing;
  started = true;
  render();
});

/**
 * Nominally 32 s for a full year, so roughly 11 days a second.
 *
 * Nominally, because `TSUYU_HOLD` below slows 65 of the 365 days to 0.4x, which
 * costs those days 2.5x their share: the loop actually runs
 * (300 + 65/0.4) / 365 ≈ 1.27 times this, or about 40 s. The previous figure
 * here claimed 24 s and the real loop was 30.
 *
 * Forty is set by reading rather than by watching. The feed in facts.ts lands
 * seventeen cards across the year, so the loop length *is* the reading pace — at
 * the old rate a card was replaced about every two seconds, which is faster
 * than any of them can be read.
 */
const DAYS_PER_MS = 365 / 32_000;

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
  natsu,
  natsuHandle,
  weather,
  terrain,
  scene,
  glow,
});
