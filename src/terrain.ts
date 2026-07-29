import { Color, JAPAN_GSI_ELEVATION_DECODER } from "@navaramap/three";
import type ThreeView from "@navaramap/three";

export const GSI_DEM_URL =
  "https://cyberjapandata.gsi.go.jp/xyz/dem_png/{z}/{x}/{y}.png";
/**
 * CARTO dark_nolabels: land darker than water, crisp coastlines, no place names
 * competing with the DOM overlay. GSI has no dark equivalent — 淡色地図 was the
 * previous base and is light by design, and `blank` 白地図 fills the ocean as
 * well as the land, flattening the land/sea distinction entirely.
 *
 * Most CARTO snippets use an `{s}` subdomain template. Navara's `raster-tile`
 * source has no subdomain support (its description exposes only url/minZoom/
 * maxZoom/overscaledMaxZoom/tms), but basemaps.cartocdn.com serves the same
 * tiles subdomain-free.
 */
export const CARTO_DARK_URL =
  "https://basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}.png";
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
   * the blue. This is the same reason the light 淡色地図 this replaced read
   * clearly: it was nearly white. The dark theme is carried by the *world* being
   * black, not by Japan being dark.
   *
   * The far north still fades toward the horizon. That is real aerial
   * perspective, not a bug: haze accumulates along the ray, and Hokkaido is
   * ~2,000 km further away than Kyushu.
   */
  highlightColor?: string;
  highlightOpacity?: number;
};

export function addJapanTerrain(
  view: ThreeView<never>,
  {
    exaggeration = 20,
    hillshadeExaggeration = 3,
    basemap = false,
    basemapOpacity = 0.85,
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
  });

  // Render order is add order: terrain first, then everything draped on it.
  const terrain = view.addLayer({ type: "terrain", source: dem, terrain: {} });

  // The dark tiles are the base and the relief goes *over* them. The light 淡色
  // basemap this replaced worked the other way round — a pale wash on top of the
  // hillshade — which is exactly what a dark theme cannot do: any wash bright
  // enough to separate land from sea also erases the shading underneath.
  let dark;
  if (basemap) {
    const darkSource = view.addSource({
      type: "raster-tile",
      url: CARTO_DARK_URL,
      // Matches the DEM, so there is no second tile pyramid to fetch.
      maxZoom: 14,
    });
    dark = view.addLayer({
      type: "raster",
      source: darkSource,
      // Opacity lives on the material, not on the layer.
      raster: { opacity: basemapOpacity },
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

  view.attribution?.add([
    {
      attribution: "国土地理院 標高タイル・陰影起伏図",
      attributionUrl: "https://maps.gsi.go.jp/development/ichiran.html",
    },
    // Both credits are required by CARTO's basemap terms.
    {
      attribution: "© OpenStreetMap contributors",
      attributionUrl: "https://www.openstreetmap.org/copyright",
    },
    {
      attribution: "© CARTO",
      attributionUrl: "https://carto.com/attributions",
    },
  ]);

  return { dem, terrain, hillshade, dark, japan };
}
