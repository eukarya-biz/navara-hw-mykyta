# 日本の季節前線 — Japan's Seasonal Fronts

An interactive map of Japan built with [Navara](https://navara-docs.netlify.app/),
showing the country's phenological fronts sweeping across the archipelago over a
single year. The camera never moves: the data does.

Toggle any combination of 桜 (cherry blossom), 紅葉 (maple) and 銀杏 (ginkgo) —
all three are on by default — and scrub the one-year timeline. The graph under
the scrubber overlays every selected series on a shared scale, so it is visible
at a glance that 桜 peaks in spring while 紅葉 and 銀杏 peak in autumn.

桜 runs **south to north**. 紅葉 and 銀杏 run **north to south**.

## Why this needs a 3D map engine

The point is not that the dots move — a 2D map does that. It is that **Japan's
seasonal fronts are shaped by its mountains**:

- Cherry blossom opens roughly **2–3 days later per 100 m** of elevation, so the
  front bends around the Japanese Alps rather than crossing them as a line.
- Autumn colour starts once minimum temperatures fall below about 8 °C, so it
  begins on the high peaks of Daisetsuzan in September and *descends*.

With the GSI DEM exaggerated and hillshaded, the terrain is visibly causing the
pattern. And because Navara derives the sun from `atmosphere.date`, wiring the
timeline to it makes the light seasonal too — a low raking sun in winter, flat
and high in summer.

## Run it

```bash
pnpm i
```

```bash
pnpm dev
```

Then open <http://localhost:8080/>.

> **If install or dev fails with `ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION`:** pnpm 11
> refuses packages published in the last 24 hours by default, and `@navaramap/*`
> releases are recent. Either wait, or run
> `pnpm i --config.minimumReleaseAge=0` and start vite directly with
> `node node_modules/vite/bin/vite.js --port 8080`.

## Rebuild the dataset

`public/data/phenology.geojson` is committed, so this is only needed to refresh it:

```bash
node scripts/build-phenology.mjs
```

The script pulls JMA's 生物季節観測 累年値 CSVs (Shift_JIS, MMDD integers, one
column pair per year from 1953), and joins stations to JMA's AMeDAS table by
Japanese name to recover latitude, longitude and **elevation**. It writes both
all-years means and two equal-length era means (1953–1982 vs 1996–2025).

## Data and caveats

Source: 気象庁 生物季節観測 ([data](https://www.data.jma.go.jp/sakura/data/)),
station coordinates from 気象庁 AMeDAS, terrain and basemap from 国土地理院.

Honest limitations, because they affect how the map should be read:

- **The front is not one species travelling north.** JMA's reference tree is
  ソメイヨシノ across most of Japan, but 寒緋桜 in Okinawa and エゾヤマザクラ in
  Hokkaido.
- **Stations are lowland.** JMA's observation posts are city meteorological
  offices, so the station data alone cannot evidence the elevation effect; the
  2–3 days/100 m relationship above comes from the literature, not from these
  points. A continuous raster (MODIS NDVI / snow cover) is the correct evidence
  and is not yet wired in.
- **Okinawa and the Ryukyus are outside the framing.** Holding them as well
  shrinks the main islands until the front stops reading, so the early-February
  Okinawa bloom is counted in the readout but not visible.
- **Observations were reduced in 2021**, so some series thin out toward the present.
- Dates shown are **means across the record**, not any single year.

## Notable finding in the data

Most of Japan now blooms about **5–7 days earlier** than in the 1953–1982 period.
Naha is the exception: it blooms **23 days later**. Warmer winters fail to deliver
the chilling that breaks dormancy, so in the far south warming *delays* the
blossom rather than advancing it.

## Structure

| Path | Role |
|---|---|
| `src/main.ts` | View setup, camera, clock, sun sync |
| `src/terrain.ts` | GSI DEM + hillshade + basemap, and the exaggeration decoder |
| `src/stations.ts` | GeoJSON layer and the `FeatureEvaluator` styling |
| `src/modes.ts` | One config per pill: keys, colour ramp, timing envelope |
| `src/ui.ts`, `src/ui.css` | DOM overlay — readout, pills, graph, scrubber |
| `scripts/build-phenology.mjs` | JMA CSV → GeoJSON |

Two Navara notes worth knowing if you read the code, both commented in place:

- **There is no vertical-exaggeration option for terrain**, so `terrain.ts`
  forges an `ElevationDecoder`. The field that scales height is `epsilon`
  (metres per raw unit). Scaling the RGB channel weights instead — the intuitive
  reading — pushes the raw value past `boundary` into the two's-complement
  negative branch and produces kilometre-long spikes with no error.
- **Station points must be `clampToGround`**, because 2D GeoJSON sits at
  ellipsoid height 0 and would otherwise be buried under the exaggerated surface.

## Licence

Dual-licensed Apache-2.0 / MIT, inherited from
[`navara-template`](https://github.com/reearth/navara-template).
