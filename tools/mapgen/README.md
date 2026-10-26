# Map generators

Each authored map's coordinates are computed once by a small Python script (point symmetry about the
centre, smooth outlines, mirrored rocks) and stored in `src/maps/<id>.ts` as plain numbers, so every
client builds byte-identical terrain without running any of this.

- `tsemit.py`: writes a `MapDef` TypeScript file from a Python dict.
- `meadow_pond.py`: Meadow Pond's shapes as JSON (the map file was written from it).
- `forest_floor.py`: Forest Floor, a draft: `python3 tools/mapgen/forest_floor.py src/maps/forestFloor.ts`.

After regenerating: `npx vite-node tools/validate-maps.ts -- <id>`, then
`npx vite-node tools/map-dump.ts -- <id> /tmp/m.json && python3 tools/map-sketch.py /tmp/m.json docs/maps/sketches/<id>.png`.
