# Photo Map basemap

The bundled `world.pmtiles` covers zooms 0–5. It is an extract of the [2026-11-21 Protomaps build](https://build.protomaps.com/20261121.pmtiles), with SHA-256 `ba0e230859f961f29c724045e2a9dda1e6e4a67cca8e395edac8a67e17dce3c6` for this bundled extract. Rebuild with `pmtiles extract https://build.protomaps.com/20261121.pmtiles world.pmtiles --maxzoom=5` from a machine with access to the source snapshot. The original build date, layer schema, and attribution are retained in the archive metadata. Distribution of this base map follows the [Protomaps basemap terms](https://docs.protomaps.com/basemaps/downloads) and includes [© OpenStreetMap contributors](https://www.openstreetmap.org/copyright). Higher zooms overzoom the same base map.

The [Protomaps glyph assets](https://github.com/protomaps/basemaps-assets) contain glyphs for Noto Sans Regular. Noto Sans is under the SIL Open Font License, reproduced in `OFL.txt`.
