# 日本の季節前線 — Japan's Seasonal Fronts

An interactive map of Japan built with [Navara](https://navara-docs.netlify.app/),
showing the country's phenological fronts sweeping across the archipelago over a
single year. The camera never moves: the data does.

Toggle any combination of 桜 (cherry blossom), 紅葉 (maple) and 銀杏 (ginkgo) —
all three are on by default — and scrub the one-year timeline. The graph under
the scrubber overlays every selected series on a shared scale, so it is visible
at a glance that 桜 peaks in spring while 紅葉 and 銀杏 peak in autumn.

桜 runs **south to north**. 紅葉 and 銀杏 run **north to south**.

Each front is drawn as instanced procedural geometry rather than a map symbol, and
each gets its own shape: a five-petal blossom, a serrated five-lobe momiji, and a
cluster of three cleft ginkgo fans. They sit on per-station tangent frames and turn
in the seasonal sun, so which front you are looking at is legible from the form
alone, not just the colour.

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

## Validation

The computed values are checked against JMA's own published 平年値 (1991–2020
normals) on
[さくらの開花日](https://www.data.jma.go.jp/sakura/data/sakura003_07.html),
which is an independent page from the 累年値 CSVs the pipeline reads:

| | |
|---|---|
| Stations compared | 56 / 56 |
| Median difference | −1.2 days |
| Std. deviation | 0.68 days |
| Max abs. difference | 2.7 days |
| Within 3 days | 56 / 56 |

The small negative bias is expected: this comparison uses the 1996–2025 window
against JMA's 1991–2020 normals, and blooming is advancing, so ours should be
slightly earlier.

That check earned its keep. It surfaced a real bug: kanhizakura in Okinawa
sometimes opens in **late December** (那覇 on 12/31/2010 and 12/28/2013), and a
naive day-of-year put those at 365, so averaging them with early-January dates
dragged the mean two weeks later and invented a trend. `wrapAfter` in the build
script now assigns late-December dates to the season that ends the following
year. Before the fix the same comparison had a std. deviation of 4.05 days and a
worst case of 21.6 days.

## What the data shows

Comparing two equal 30-year windows, 1953–1982 against 1996–2025:

- **Spring is arriving earlier.** Cherry blossom opens a median **4.7 days
  earlier**, at 90 of 96 stations. Largest advances: 久米島 −12.1, 宮古島 −9.1,
  函館 −8.5, 福岡 −8.2 days.
- **Autumn is arriving later, and by more.** Maple colouring is a median
  **11.8 days later**, at 66 of 69 stations.
- **The subtropical islands run the other way in spring.** Every station that
  now blooms *later* is subtropical — 名護 +9.0, 南大東島 +4.9, 石垣島 +4.1,
  西表島 +3.6 days. The likely mechanism is winter chilling: these trees need a
  cold period to break dormancy, and warm winters no longer reliably supply it,
  so warming delays the blossom instead of advancing it.

Read together, the growing season is stretching at both ends.

## Structure

| Path | Role |
|---|---|
| `src/main.ts` | View setup, camera, clock, sun sync |
| `src/terrain.ts` | GSI DEM + hillshade + basemap, and the exaggeration decoder |
| `src/blossoms.ts` | The instanced-mesh descriptor, placement and per-frame animation |
| `src/blossomGeometry.ts` | Procedural blossom / momiji / ginkgo geometry |
| `src/phenology.ts` | Parsed stations, the clock, and every derived tally |
| `src/stations.ts` | GeoJSON layer and the `FeatureEvaluator` styling — the sprite fallback |
| `src/modes.ts` | One config per pill: keys, colour ramp, timing envelope, 3D style |
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
