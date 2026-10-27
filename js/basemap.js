/* global L */
// English-labelled basemap: OpenFreeMap's colour "Liberty" style (OpenStreetMap data, free, no
// key; parks and woods green, water blue), with every name label switched to the English name,
// or the romanised one. Labels with neither are left off, so the map never falls back to Japanese
// script. Phones without WebGL get GSI's raster map instead, which is labelled in Japanese.
import { TILES } from "./util.js";

const STYLE = "https://tiles.openfreemap.org/styles/liberty";
const ENGLISH = ["coalesce", ["get", "name:en"], ["get", "name:latin"], ""];
const ATTRIBUTION = '<a href="https://openfreemap.org" target="_blank" rel="noopener">OpenFreeMap</a> · <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">© OpenStreetMap</a>';

let style;
async function englishStyle() {
  style ||= fetch(STYLE).then((r) => r.json()).then((s) => {
    // The style's own shop, food and parking icons look like our pins, so they go; stations stay
    s.layers = s.layers.filter((layer) => !/^poi_r\d+$/.test(layer.id));
    for (const layer of s.layers) {
      // Only name labels: route-number shields keep their own text
      const field = layer.layout?.["text-field"];
      if (field && JSON.stringify(field).includes("name")) layer.layout["text-field"] = ENGLISH;
    }
    return s;
  });
  return style;
}

const webgl = (() => {
  try { return !!document.createElement("canvas").getContext("webgl2") || !!document.createElement("canvas").getContext("webgl"); } catch { return false; }
})();

export async function addBasemap(map, { interactive = true } = {}) {
  if (webgl && L.maplibreGL) {
    try {
      return L.maplibreGL({ style: await englishStyle(), attribution: ATTRIBUTION, interactive }).addTo(map);
    } catch { /* fall through to raster */ }
  }
  return L.tileLayer(TILES, {
    maxZoom: 19, maxNativeZoom: 18,
    attribution: '<a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank" rel="noopener">地理院タイル</a>',
  }).addTo(map);
}
