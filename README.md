# 日本の季節前線 — Japan's Seasonal Fronts

An interactive map of Japan built with [Navara](https://navara-docs.netlify.app/),
showing the country's phenological fronts sweeping across the archipelago over a
single year. The camera never moves: the data does.

Toggle any combination of 桜 (cherry blossom), 紅葉 (maple), 銀杏 (ginkgo),
梅雨 (the rainy season) and 雪 (snow) — all five are on by default — and scrub the
one-year timeline by dragging anywhere in it, the graph included. That graph overlays
every selected series on a shared scale, so it is visible at a glance that 桜 peaks in
spring while 紅葉 and 銀杏 peak in autumn, with 梅雨 filling the one gap between them
and 雪 running off both ends of the year.

As the year runs, the findings arrive as a feed on the left: a card on the day it
becomes true, four on screen at once, the older ones receding. It is a pure function
of the day and the selection, so scrubbing backwards takes cards away again and the
year wrap clears the column.

桜 runs **south to north**. 紅葉, 銀杏 and 雪 run **north to south**. 梅雨 also runs
south to north — and then stops: there is no 梅雨 in Hokkaido. 雪 is the mirror
image, and divides the country the other way: east against west.

Each front is drawn as instanced procedural geometry rather than a map symbol, and
each gets its own shape: a five-petal blossom, a serrated five-lobe momiji, a
cluster of three cleft ginkgo fans, and a six-armed stellar dendrite. They sit on
per-station tangent frames and turn in the seasonal sun, so which front you are
looking at is legible from the form alone, not just the colour.

## 梅雨 — the front that arrives all at once, and stops

The other three are metaphors. 桜前線 is an interpolation drawn through point
observations; nothing in the atmosphere is moving. 梅雨前線 is a real stationary
front, and it is the only thing here that genuinely *is* weather — so it is drawn
as weather: a volumetric cloud deck confined to the regions currently inside the
season, plus a raindrop overlay on the glass, rather than as markers at points.
There is no front *line*; the leading edge is emergent, because each region's cloud
fades in on that region's own announced date, so the advance happens in real 地方
steps instead of being interpolated through a curve nobody measured.

It is also the only series read for **12 地方** instead of at observation stations,
because that is how JMA announces it: one date for a whole region. The readout
counts 地方, and because 12 regions and ~90 stations are not the same quantity, the
graph plots 梅雨 against its own denominator — all twelve inside reaches the top of
the graph, where the station curves reach at their own peaks — and sorts it behind
them in the draw order.

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

## 雪 — the season that divides the country the other way

梅雨 cuts Japan north from south and stops at the Tsugaru Strait. 雪 cuts it **east
from west**, and that is the whole reason it is here.

金沢 and 東京 sit about one degree of latitude apart. 金沢 gets **157 cm** of snowfall
in an average year and 東京 gets **8** — nineteen times less. Twenty-two of the 142
snow-observing stations record a first and last snow every year and a maximum snow
depth of **zero**: it falls, it never lies. The mechanism is the winter monsoon: cold
air out of Siberia crosses the Sea of Japan, picks up moisture over the warm current,
and unloads it on the windward side of the mountain spine. What crosses to the
Pacific side is dry.

So the map draws the consequence, and lets the consequence draw the wind:

- The cloud deck's strength at each station is its own **最深積雪**, so 北陸 and
  東北 are buried and the Tokai coast is under clear sky, with the spine as the
  divide.
- The deck is painted as **bands elongated along the monsoon bearing** rather than
  as round blobs — 筋状の雲, the parallel cloud streets that are what a Japanese
  winter actually looks like from orbit.
- Each station's crystal is sized by its 最深積雪 too, so the asymmetry is legible
  from the markers alone with the cloud switched off. This is the only mode whose
  source measures an *amount* as well as a date; the three biological fronts are
  all the same size everywhere, because a date is all they have.

It is also the only season with **all three edges measured** — 雪の初日, the month
最深積雪 peaks in, and 雪の終日 — and the first whose window **crosses the new year**:
稚内's snow starts on 10月19日 and ends on 5月10日, so `end` is numerically before
`start` at 120 of the 142 stations. The timeline shows it running off both ends.

And the mirror of 北海道に梅雨はない: fifteen stations have no 雪 at all — 沖縄, 奄美,
種子島 and 屋久島, and the Ogasawaras. That one could never be a label on the map,
because the framing deliberately excludes the Ryukyus and the label would point off
the edge of the frame at something the viewer cannot see. It is a card in the feed
instead, which is a good part of why the feed exists: a finding about places outside
the frame is still a finding.

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

Sources: 気象庁 生物季節観測 ([data](https://www.data.jma.go.jp/sakura/data/)),
気象庁 梅雨入りと梅雨明け
([data](https://www.data.jma.go.jp/cpd/baiu/index.html)) and 気象庁 地上気象観測平年値
1991–2020 ([data](https://www.data.jma.go.jp/stats/data/mdrr/normal/index.html)),
station coordinates from 気象庁 AMeDAS and from the normals archive's own station
index, terrain and basemap from 国土地理院.

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
  region, so nothing anchors cloud there — the paint grid rejects any cell more
  than 140 km from a 梅雨 station, which puts the deck's edge just short of the
  Tsugaru Strait without a coastline being loaded — and the build asserts the count
  rather than letting it be inferred.
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
- **There is no interpolated front line.** Each painted cell carries its own
  region's announced dates, so the leading edge advances in real 地方 steps and is
  never drawn through days nobody measured. That matters because onset is genuinely
  not monotone in latitude — 北陸 at 37.9°N starts on 6月11日, four days *after*
  関東甲信 at 35.7°N, because the Sea-of-Japan side runs late — and any smooth curve
  through the dates has to either lie about that or double back on itself.
- **The cloud shape is noise, not observation.** JMA publishes a date per region and
  nothing about where inside it the rain is. The billows, holes and band texture come
  from the effect's shape noise and a per-cell hash; only the deck's *extent* and its
  *timing* are data.
- **雪's cloud is not observed cloud either.** Its bands are oriented along a single
  hard-coded monsoon bearing (135°, southeast) rather than a wind field — there is no
  gridded wind data in this project. The bearing is climatology; the strength under
  it is 最深積雪, which is measured.
- **The weather is drawn far larger than life.** At this camera a vertical offset
  projects to only h/4,620 pixels, so the whole troposphere is 2.6 px and rain shafts
  from a cloud base to the ground would be about 4 px. The decks are correspondingly
  exaggerated in thickness and in noise scale, which is the same licence already
  taken by a 25 km-wide cherry blossom.
- **雪's normals window is not always 1991–2020.** 90 of the 142 snow stations were
  relocated during the period and JMA restarts the window at the move, some as late
  as 2012. Each feature carries its own `yukiHatsu_from`/`_to` and observation count.
- **There is no then-vs-now shift for 雪.** The archive publishes one normals window,
  not a per-year series, so the era comparison the other seasons get is not available
  here.
- **富士山 anchors a crystal but not cloud.** Its 214 cm of lying snow is real and the
  deepest in the country, but it is a 3,775 m summit reading and describes nothing
  within a hundred kilometres. Left as a cloud anchor it put the heaviest deck in
  Japan over the *Pacific* side of Honshu and contradicted the finding, so stations
  above 2,000 m are excluded from the cloud grid and kept in the markers.
- **雪's deck stops 260 km offshore.** The real cloud streets form across the whole
  Sea of Japan, from the continental coast eastward. The stations are the only
  geography this project loads, so the paint can only reach as far from one as the
  mask allows.

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
| `src/blossomGeometry.ts` | Procedural blossom / momiji / ginkgo / snow-crystal geometry |
| `src/phenology.ts` | Parsed stations, the clock, and every derived tally |
| `src/stations.ts` | GeoJSON layer and the `FeatureEvaluator` styling — the sprite fallback |
| `src/weather.ts` | The scene's one volumetric cloud pass, shared by both weather seasons |
| `src/weatherMap.ts` | Geography → coverage texture, with no view attached: projection, grid, canvas |
| `src/tsuyu.ts` | The 12 regional 梅雨 windows, their tallies, its cloud channel and the rain overlay |
| `src/snow.ts` | The 142 snow stations, their tallies and weights, the 筋状雲 channel and the falling snow |
| `src/modes.ts` | One config per pill: keys, colour ramp, timing envelope, 3D and weather style |
| `src/facts.ts` | The feed's cards — one finding per entry, with the day it arrives |
| `src/ui.ts`, `src/ui.css` | DOM overlay — readout, pills, the fact feed, graph, scrubber |
| `scripts/build-phenology.mjs` | JMA 生物季節観測 CSV → GeoJSON |
| `scripts/build-tsuyu.mjs` | JMA 梅雨 CSV → GeoJSON, and the 地方 partition assertions |
| `scripts/build-snow.mjs` | JMA 地上気象観測平年値 zip → GeoJSON, and the element-code assertions |
| `scripts/regions.mjs` | The 12 地方, their anchor stations and member stations |
| `scripts/jma.mjs` | Shared by all three builds: Shift_JIS fetch, calendar, era means |

Navara notes worth knowing if you read the code, all commented in place:

- **There is no vertical-exaggeration option for terrain**, so `terrain.ts`
  forges an `ElevationDecoder`. The field that scales height is `epsilon`
  (metres per raw unit). Scaling the RGB channel weights instead — the intuitive
  reading — pushes the raw value past `boundary` into the two's-complement
  negative branch and produces kilometre-long spikes with no error.
- **Station points must be `clampToGround`**, because 2D GeoJSON sits at
  ellipsoid height 0 and would otherwise be buried under the exaggerated surface.
- **There is only one volumetric cloud pass available.** `CloudsEffectDesc` declares
  no `static allowDuplication`, unlike `FogLightEffectDesc` and `RainDropEffectDesc`,
  so `view.addEffect` will not give out a second. 梅雨 and 雪 share one pass and are
  kept apart by taking different *colour channels* of one local-weather canvas: the
  effect drives an independent cloud layer per channel, each with its own altitude,
  thickness and density. That is only safe because the two seasons never coincide,
  which is why the genuinely global knobs are handed to whichever deck is active.
- **`localWeatherVelocity` must stay at zero here.** The pass integrates it into
  `localWeatherOffset` every frame, and every texel position the painter computes
  assumes that offset is constant. Give it any velocity and the sampling window walks
  away from what the paint was projected for: within a minute the offset had moved
  half a repeat tile and *neither* deck rendered at all. Drift belongs in the shape
  of the paint, or in `shapeOffset`, which moves the erosion noise without moving the
  deck.
- **A cloud layer with `densityScale: 0` is not free.** It still contributes its
  altitude band to the interval the ray marches, and the default third layer is a
  cirrus veil at 7.5–8 km. Left alone it stretched the marched shell from 900 m to
  8,000 m for nothing, so the dead layers are collapsed onto a live one's band.
- **The effect's height profile only makes cloud in the bottom ~40% of a layer.**
  `shapeAlteringBias` peaks at a height fraction of about 0.14, so a 1.4 km shell has
  roughly 560 m of usable depth — which is why 雪's `densityScale` is four times
  梅雨's despite looking thinner on paper.
- **`coverage` is global and `coverageFilterWidth` is per layer.** An unpainted texel
  stays cloud-free only while `coverage ≤ 1 − filterWidth` for *every* live layer,
  and past that the flood comes out of whichever layer has the widest window, not
  necessarily the one you were adjusting.

## Licence

Dual-licensed Apache-2.0 / MIT, inherited from
[`navara-template`](https://github.com/reearth/navara-template).
