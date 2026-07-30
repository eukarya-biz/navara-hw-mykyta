# 日本の季節前線 — Japan's Seasonal Fronts

An interactive map of Japan built with [Navara](https://navara-docs.netlify.app/),
showing the country's phenological fronts sweeping across the archipelago over a
single year. The camera never moves: the data does.

Toggle any combination of 桜 (cherry blossom), 紅葉 (maple), 銀杏 (ginkgo) and
梅雨 (the rainy season) — all four are on by default — and scrub the one-year
timeline. The graph under the scrubber overlays every selected series on a shared
scale, so it is visible at a glance that 桜 peaks in spring while 紅葉 and 銀杏 peak
in autumn, with 梅雨 filling the one gap between them.

桜 runs **south to north**. 紅葉 and 銀杏 run **north to south**. 梅雨 also runs
south to north — and then stops: there is no 梅雨 in Hokkaido.

Each front is drawn as instanced procedural geometry rather than a map symbol, and
each gets its own shape: a five-petal blossom, a serrated five-lobe momiji, and a
cluster of three cleft ginkgo fans. They sit on per-station tangent frames and turn
in the seasonal sun, so which front you are looking at is legible from the form
alone, not just the colour.

## 梅雨 — the front that arrives all at once, and stops

The other three are metaphors. 桜前線 is an interpolation drawn through point
observations; nothing in the atmosphere is moving. 梅雨前線 is a real stationary
front, and it is the only thing here that genuinely *is* a line crossing the
archipelago — so it is drawn as one, as a pair of glowing arcs bounding a cloud
deck, rather than as markers at points.

It is also the only series read for **12 地方** instead of at observation stations,
because that is how JMA announces it: one date for a whole region. The readout
counts 地方 and the graph draws 梅雨 as a band behind the other curves rather than
as a fourth curve, since 12 regions and ~90 stations are not the same quantity.

Three things are visible that the biological series cannot show:

- **It is a sheet, not a sweep.** 桜 takes about 110 days to cross the country.
  梅雨 onset covers the same ground in 36 (5月10日 沖縄 → 6月15日 東北北部), and once
  沖縄 and 奄美 are set aside the entire mainland turns on inside **11 days** — 九州
  北部 on 6月4日, 東北北部 on 6月15日. Five regions then end on the same day, 7月19日.
  For about a month everything except Hokkaido is under it at once.
- **The end is fuzzier than the start.** Across 1951–2025 only **two** 梅雨入り
  could not be determined (四国 and 近畿, both 1963) against **26** 梅雨明け — none
  at all in 沖縄, 奄美 or either half of 九州, rising to eight in 東北北部. 1993 alone
  accounts for ten of them: every region except 沖縄 and 奄美.
- **And then it stops existing.** 北海道 has no 梅雨 to be determined or not.

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

梅雨 comes from a different JMA dataset and has its own script:

```bash
node scripts/build-tsuyu.mjs
```

That one reads `tsuyu_iriake.csv` and `tsuyu_prec.csv` from 気象庁 梅雨入りと梅雨明け
（確定値）— Shift_JIS again, but with month and day as *separate integer columns*
and `-9999` where the date could not be determined. The `平年` row is JMA's
1991–2020 normal, and that is what the map animates.

Because the CSV is read by column offset, the script asserts what it parsed: 49
columns, each region header matching its expected name, every day-of-year inside
110–230, and the twelve parsed `平年` pairs deep-equal to the pairs JMA publishes
per region. It also asserts that all 102 stations in `phenology.geojson` fall into
exactly one 地方 or into Hokkaido — **86 + 16 = 102** — so a future rebuild that
adds a station breaks this build instead of silently mis-assigning it.

## Data and caveats

Sources: 気象庁 生物季節観測 ([data](https://www.data.jma.go.jp/sakura/data/)) and
気象庁 梅雨入りと梅雨明け
([data](https://www.data.jma.go.jp/cpd/baiu/index.html)), station coordinates from
気象庁 AMeDAS, terrain and basemap from 国土地理院.

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
- Dates shown are **means across the record**, not any single year — except 梅雨,
  see below.
- **梅雨 is regional, not per-station.** The deck over 東海 carries 東海地方's dates,
  one pair for four prefectures. There is no Shizuoka reading, which is why the
  readout says 地方 and the count is out of 12.
- **北海道 has no 梅雨.** This is not missing data. JMA defines none:
  梅雨前線は北海道付近では不明瞭となることが多い. The 16 Hokkaido stations belong to no
  region, the cloud grid stops at 41.0°N so the deck's visible edge lands just
  short of the Tsugaru Strait, and the build asserts the count rather than letting
  it be inferred.
- **The 梅雨 dates are 頃.** JMA's own announcements say 「○月○日頃」 because there is
  a 平均５日間程度 transition at each edge. Those five days are the marker's onset and
  withdrawal ramps, and both sit *inside* the announced window, so nothing is drawn
  on a day JMA did not name.
- **梅雨 uses JMA's 1991–2020 normals rather than an all-years mean**, unlike the
  three biological series. 26 of 900 region-years have no 梅雨明け, and they are not
  missing at random — they are the anomalously late seasons — so an all-years mean
  would be biased early by exactly the years that matter most.
- **The 伊豆諸島 count as 関東甲信**, because JMA defines that region as 東京都 plus
  eight prefectures and 東京都 includes 八丈島 at 33.1°N. So 八丈島 enters 梅雨 with
  東京 on 6月7日, about four weeks after 九州南部 at the same latitude. Correct by
  definition, and odd to the eye.
- **The 前線 lines are interpolated, the deck is not.** Each cloud cell carries its
  own region's announced dates, so the leading edge advances in real 地方 steps. The
  two arcs are a monotone interpolation between those dates — the atmosphere, not a
  measurement. Onset is genuinely not monotone in latitude (北陸 at 37.9°N starts on
  6月11日, four days after 関東甲信 at 35.7°N, because the Sea-of-Japan side runs
  late), so the line takes a running maximum and the deck keeps the real order.
- **梅雨 is drawn far larger than life.** At this camera a vertical offset projects
  to only h/4,620 pixels, so the whole troposphere is 2.6 px and rain shafts from a
  cloud base to the ground would be about 4 px. Weather here has to be a plan-view
  phenomenon: the deck is a 16 km-high sheet of 34 km puffs, which is the same
  licence already taken by a 25 km-wide cherry blossom.

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

梅雨's own record, over the same two windows, says something a little different —
what has changed is less the date than whether there *is* a date:

- **梅雨明け is becoming harder to name, and the effect grows with latitude.** In
  東北北部 the end of the rainy season could be determined in all 30 years of
  1953–1982, but in only 23 of 30 across 1996–2025. Its 明け date itself barely
  moved over the same span, by **+0.8 days**.
- **梅雨入り has drifted earlier in the south and later in the north**: 東海 −3.2,
  中国 −2.3, 九州北部 −2.1 days, against 奄美 +2.3 and 東北南部 +2.0.
- **The rainy season is getting drier in the west and wetter in the north.** Rainfall
  as a percentage of normal shifted 中国 −10.4 and 近畿 −8.1 points, against
  東北北部 +4.4 and 東北南部 +3.6 — with 九州南部 the outlier at **+19.3**.

## Structure

| Path | Role |
|---|---|
| `src/main.ts` | View setup, camera, clock, sun sync |
| `src/terrain.ts` | GSI DEM + hillshade + basemap, and the exaggeration decoder |
| `src/blossoms.ts` | The instanced-mesh descriptor, placement and per-frame animation |
| `src/blossomGeometry.ts` | Procedural blossom / momiji / ginkgo geometry |
| `src/phenology.ts` | Parsed stations, the clock, and every derived tally |
| `src/stations.ts` | GeoJSON layer and the `FeatureEvaluator` styling — the sprite fallback |
| `src/tsuyu.ts` | The 12 regional 梅雨 windows, their tallies, the cloud deck and the two 前線 |
| `src/front.ts` | 梅雨 geometry with no view attached — the cloud grid and the front curve |
| `src/modes.ts` | One config per pill: keys, colour ramp, timing envelope, 3D style |
| `src/ui.ts`, `src/ui.css` | DOM overlay — readout, pills, graph, scrubber |
| `scripts/build-phenology.mjs` | JMA 生物季節観測 CSV → GeoJSON |
| `scripts/build-tsuyu.mjs` | JMA 梅雨 CSV → GeoJSON, and the 地方 partition assertions |
| `scripts/regions.mjs` | The 12 地方, their anchor stations and member stations |
| `scripts/jma.mjs` | Shared by both builds: Shift_JIS fetch, calendar, era means |

Four Navara notes worth knowing if you read the code, all commented in place:

- **There is no vertical-exaggeration option for terrain**, so `terrain.ts`
  forges an `ElevationDecoder`. The field that scales height is `epsilon`
  (metres per raw unit). Scaling the RGB channel weights instead — the intuitive
  reading — pushes the raw value past `boundary` into the two's-complement
  negative branch and produces kilometre-long spikes with no error.
- **Station points must be `clampToGround`**, because 2D GeoJSON sits at
  ellipsoid height 0 and would otherwise be buried under the exaggerated surface.
- **`ArclineMeshDesc` keeps the point array you first hand it**, then diffs incoming
  points against it field by field. Pass the same array back and it compares it with
  itself, finds no change, and the line silently never moves again — so the 前線
  allocates fresh point objects every frame. `SmoothLineMeshDesc` looks like the
  natural choice for a line and is not: it extends plain `MeshDesc`, never calls
  `setupSelectiveEffectUniforms`, and so cannot glow through the selective bloom.
- **`ArcLine` computes its bounding sphere once and then stubs out
  `computeBoundingSphere`**, so the bounds stay at the latitude the line was born
  at and it is culled the moment it migrates away. `frustumCulled = false` on each
  sub-mesh, for the same reason the instanced meshes set it.

## Licence

Dual-licensed Apache-2.0 / MIT, inherited from
[`navara-template`](https://github.com/reearth/navara-template).
