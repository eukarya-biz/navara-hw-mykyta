import { JAPAN_GSI_ELEVATION_DECODER } from "@navaramap/three";
import type ThreeView from "@navaramap/three";

export const GSI_DEM_URL =
  "https://cyberjapandata.gsi.go.jp/xyz/dem_png/{z}/{x}/{y}.png";
/**
 * 淡色地図. GSI's `blank` 白地図 was tried first for its lack of place labels,
 * but it fills the ocean as well as the land, so it flattens the land/sea
 * distinction entirely. `pale` keeps water visibly separate from land.
 */
export const GSI_PALE_URL =
  "https://cyberjapandata.gsi.go.jp/xyz/pale/{z}/{x}/{y}.png";

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
  /** Draw GSI's 淡色地図 over the relief, for land/sea separation. */
  basemap?: boolean;
  /** Opacity of that basemap. */
  basemapOpacity?: number;
};

export function addJapanTerrain(
  view: ThreeView<never>,
  {
    exaggeration = 20,
    hillshadeExaggeration = 3,
    basemap = false,
    basemapOpacity = 0.45,
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

  // Geometric relief alone is a couple of screen pixels at archipelago scale.
  // Hillshade off the same DEM source is what actually makes the spine read —
  // and it costs no extra tile fetches, since the source is shared.
  const hillshade = view.addLayer({
    type: "raster",
    source: dem,
    hillshade: { exaggeration: hillshadeExaggeration },
  });

  let pale;
  if (basemap) {
    const paleSource = view.addSource({
      type: "raster-tile",
      url: GSI_PALE_URL,
      maxZoom: 14,
    });
    pale = view.addLayer({
      type: "raster",
      source: paleSource,
      // Opacity lives on the material, not on the layer.
      raster: { opacity: basemapOpacity },
    });
  }

  view.attribution?.add([
    {
      attribution: "国土地理院 標高タイル",
      attributionUrl: "https://maps.gsi.go.jp/development/ichiran.html",
    },
  ]);

  return { dem, terrain, hillshade, pale };
}
