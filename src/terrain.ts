import { Color, JAPAN_GSI_ELEVATION_DECODER } from "@navaramap/three";
import type ThreeView from "@navaramap/three";
import type { TileJsonPlugin } from "@navaramap/three-plugins";

export const GSI_DEM_URL =
  "https://cyberjapandata.gsi.go.jp/xyz/dem_png/{z}/{x}/{y}.png";
/**
 * The dark world base is drawn, not fetched: Natural Earth admin polygons
 * (Re:Earth Papers' vector tiles, key-free), with `countries` filled dark over
 * a globe coloured as the ocean — land *darker* than water, crisp coastlines,
 * and no place names competing with the DOM overlay. GSI serves no dark
 * basemap of its own: 淡色地図 is light by design, and `blank` 白地図 fills
 * the ocean as well as the land, flattening the land/sea distinction entirely.
 *
 * A TileJSON document, not a `{z}/{x}/{y}` template: `TileJsonPlugin` fetches
 * it, derives the tile endpoint and zoom range (0–8), and surfaces the
 * tileset's own attribution through `view.attribution`, so nothing beyond GSI
 * is credited by hand below.
 */
export const NATURAL_EARTH_TILEJSON_URL =
  "https://papers.reearth.land/naturalearth_admin/tilejson.json";
/**
 * Near-black land, and the faint admin-0 borders that let the continent read
 * as more than one silhouette. The land sits *below* the ocean in luminance on
 * purpose: the one bright thing on this globe is Japan, and a world dimmer
 * than the water recedes instead of competing with it.
 */
export const BASEMAP_LAND = "#090909";
export const BASEMAP_BORDER = "#555555";
/**
 * 陰影起伏図. This is what picks Japan out of the dark world basemap, and it does
 * it for free: GSI serves tiles for Japan only (anything outside 404s) and the
 * sea is genuinely transparent — alpha 0, verified by decoding a tile — so the
 * layer is a pixel-exact mask of the landmass, coastline and all. Tinting it
 * washes Japan in a colour nothing else on the globe has, and unlike 淡色地図 it
 * carries no place labels to fight the overlay.
 */
export const GSI_HILLSHADE_URL =
  "https://cyberjapandata.gsi.go.jp/xyz/hillshademap/{z}/{x}/{y}.png";

/**
 * Navara exposes no vertical-exaggeration option on the terrain layer, so the
 * lever is the elevation decoder. Its fields decode as
 *
 *   raw    = R * r_scaler + G * g_scaler + B * b_scaler + offset
 *   height = (raw + (raw >= boundary ? max_offset : min_offset)) * epsilon
 *
 * For GSI those are r/g/b = 65536/256/1 (i.e. a raw 24-bit integer),
 * boundary = 2^23 and max_offset = -2^24 (the two's-complement branch that
 * makes below-sea-level values negative), and epsilon = 0.01 — metres per unit.
 *
 * So `epsilon` is the only field to touch. Scaling the channel weights instead
 * inflates `raw` past `boundary`, throwing every tile into the negative branch
 * and producing kilometre-long spikes.
 */
export function exaggeratedGsiDecoder(factor: number) {
  const decoder = JAPAN_GSI_ELEVATION_DECODER();
  decoder.epsilon *= factor;
  return decoder;
}

export type TerrainOptions = {
  /** Vertical exaggeration of the terrain geometry. */
  exaggeration?: number;
  /** Strength of the hillshade normals, independent of the geometry. */
  hillshadeExaggeration?: number;
  /** Draw the dark basemap under the relief, for land/sea separation. */
  basemap?: boolean;
  /** Opacity of that basemap. */
  basemapOpacity?: number;
  /**
   * Registers the Natural Earth TileJSON as a source. Required when `basemap`
   * is on — the plugin has to exist before `view.init()`, so it cannot be
   * created here.
   */
  tilejson?: TileJsonPlugin;
  /** Wash Japan's landmass in `highlightColor` to lift it off the world. */
  highlight?: boolean;
  /**
   * Warm cream, and both warm and bright on purpose.
   *
   * At this camera the view ray crosses a lot of atmosphere, and the
   * aerial-perspective inscatter lays a pale *blue* wash over everything. That
   * wash is additive, so what survives it is luminance — a dark tint loses no
   * matter how saturated (pure red at full opacity is invisible over the far half
   * of the country) — and warmth, since a cool highlight simply dissolves into
   * the blue. The dark theme is carried by the *world* being black, not by
   * Japan being dark.
   *
   * The far north still fades toward the horizon. That is real aerial
   * perspective, not a bug: haze accumulates along the ray, and Hokkaido is
   * ~2,000 km further away than Kyushu.
   */
  highlightColor?: string;
  highlightOpacity?: number;
};

export async function addJapanTerrain(
  view: ThreeView<never>,
  {
    exaggeration = 20,
    hillshadeExaggeration = 3,
    basemap = false,
    basemapOpacity = 0.85,
    tilejson,
    highlight = false,
    highlightColor = "#e8d3a6",
    highlightOpacity = 1,
  }: TerrainOptions = {},
) {
  const dem = view.addSource({
    type: "raster-dem",
    url: GSI_DEM_URL,
    elevationDecoder: exaggeratedGsiDecoder(exaggeration),
    maxZoom: 14,
    /**
     * Two reasons stacked on one number. GSI has no z0 標高タイル
     * (`dem_png/0/0/0.png` 404s), so anything below 1 would eat a failure on
     * every load. And starting the pyramid at 5 rather than 1 skips the four
     * coarsest levels outright — at this fixed camera they exist only to be
     * refined past, and each was a round of fetch-decode-remesh on the way to
     * the detail the view actually shows.
     */
    minZoom: 5,
  });

  // Render order is add order: terrain first, then everything draped on it.
  const terrain = view.addLayer({ type: "terrain", source: dem, terrain: {} });

  // The dark land is the base and the relief goes *over* it — the order a dark
  // theme forces: any wash bright enough to separate land from sea, laid on
  // top, would also erase the shading underneath.
  //
  // Two layers off one source: the water is not drawn at all — it is the globe
  // colour showing through wherever no country polygon covers it, which is why
  // main.ts paints the globe as the ocean rather than as "the gaps".
  let dark;
  let borders;
  if (basemap) {
    if (!tilejson) {
      throw new Error("addJapanTerrain: basemap needs the `tilejson` plugin");
    }
    const darkSource = await tilejson.addSource({
      type: "vector-tile",
      url: NATURAL_EARTH_TILEJSON_URL,
    });
    dark = view.addLayer({
      type: "vector",
      source: darkSource,
      // `countries` alone covers every landmass; the tileset's other polygon
      // layers are the same land partitioned differently.
      sourceLayers: ["countries"],
      polygon: {
        color: new Color().setStyle(BASEMAP_LAND),
        // Same role as the raster opacity it replaces: lets a little globe
        // colour through so the land never goes fully dead.
        opacity: basemapOpacity,
        // Baked into the globe surface tiles, where the raster went.
        clampToGround: true,
      },
    });
    // Japan is cut out of the fill, and has to be: baked vector drapes
    // composite *above* every raster layer regardless of add order (the slot
    // plan is rasters-then-vectors), so this fill cannot sit under the cream
    // tint — it sits on it, and Japan turns into a dark silhouette with a warm
    // coastline sliver. The landmass loses nothing by the cut: the GSI tint is
    // opaque and masked to the same coastline. The TileJSON advertises
    // `fields: {}` but the tiles do carry the Natural Earth attributes;
    // `filters` keeps the read to the one that matters.
    dark.on("featureUpdated", ({ evaluator }) => {
      evaluator.evaluate(
        ({ properties }) => ({ show: properties?.["ADM0_A3"] !== "JPN" }),
        { filters: ["ADM0_A3"] },
      );
    });
    // Without the borders the continent behind Japan is one undifferentiated
    // silhouette; faint grey lines are enough to break it into countries.
    borders = view.addLayer({
      type: "vector",
      source: darkSource,
      sourceLayers: ["boundary_lines"],
      polyline: {
        color: new Color().setStyle(BASEMAP_BORDER),
        opacity: 0.5,
        clampToGround: true,
      },
    });
  }

  // Japan, tinted. Sits above the world basemap so the tint replaces it, and
  // below the hillshade so the relief still shades through.
  let japan;
  if (highlight) {
    const japanSource = view.addSource({
      type: "raster-tile",
      url: GSI_HILLSHADE_URL,
      maxZoom: 14,
    });
    japan = view.addLayer({
      type: "raster",
      source: japanSource,
      raster: {
        color: new Color().setStyle(highlightColor),
        opacity: highlightOpacity,
      },
    });
  }

  // Geometric relief alone is a couple of screen pixels at archipelago scale.
  // Hillshade off the same DEM source is what actually makes the spine read —
  // and it costs no extra tile fetches, since the source is shared.
  const hillshade = view.addLayer({
    type: "raster",
    source: dem,
    hillshade: { exaggeration: hillshadeExaggeration },
  });

  // The basemap's own credit (Re:Earth Papers) arrives via TileJsonPlugin,
  // which reads it out of the TileJSON document — only GSI is ours to add.
  view.attribution?.add([
    {
      attribution: "国土地理院 標高タイル・陰影起伏図",
      attributionUrl: "https://maps.gsi.go.jp/development/ichiran.html",
    },
  ]);

  return { dem, terrain, hillshade, dark, borders, japan };
}
