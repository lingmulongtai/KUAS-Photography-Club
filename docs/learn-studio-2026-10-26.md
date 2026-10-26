# Photo studio on 写真を学ぶ (2026-10-26)

The 3D photo studio is the main part of `/learn/` and `/en/learn/` (`src/components/learn/Studio.astro`,
`src/scripts/studio/`). It grew out of the design proposals of 2026-10-25: 構成 A (one studio, no
page split) with 焦点 A's floor plan was picked, the prototype was restyled to match the rest of the
site, and the proposal pages under `/learn/lab/` were removed.

The topic pages (shutter speed, aperture, focal length) keep their text. Their old demos were
replaced by `StudioTry.astro`, a list of the studio's お題 for that topic; each opens
`/learn/?mission=<id>#studio`, which starts that challenge once the studio has loaded
(`TOPIC_MISSIONS` in `missions.ts`). The darkroom page keeps its own demo.

## How the pictures are made

- `world.ts` — the set: a CC0 panorama projected onto the ground (`GroundedSkybox`) with its HDR
  for lighting, a subject, and props (torii, pinwheel, falling leaves or snow, a studio sweep).
  The panorama's JPEG clips the sun, so a small full-strength disc is drawn where the HDR is
  brightest; lens flare, ghosts and the stopped-down sunstar come from it.
- `subjects.ts`, `flowers.ts`, `stars.ts` — marble bust, drawing mannequin, porcelain horse, tea
  set, classic camera, chess set, a cosmos field and a lone tree under a generated night sky
  (Milky Way, rotation about the pole, meteors).
- `pipeline.ts` — renders in linear HDR, averages subframes over the shutter time (motion blur and
  camera shake), depth of field from the depth buffer, exposure from the settings, ISO noise and
  ACES tone mapping. `Stacker` merges interval shots by lighten or average.
- `camera.ts`, `gear.ts`, `lights.ts`, `map.ts` — the photographer (tripod or handheld, AF / tap AF
  / MF with peaking, closest focus), lenses and filters, on-camera flash and up to three stand
  lights placed on the floor plan.
- `coach.ts`, `missions.ts` — plain advice with concrete numbers, and twelve お題.
- `optics.ts` — exposure value, field of view, depth of field.

## Language

Labels that belong to things (lenses, filters, places, subjects, お題) carry `{ ja, en }`;
sentences built from numbers use `picker(lang)` with both languages side by side (`i18n.ts`). The
page passes `lang` to `Studio.astro`, which sets `data-lang` for the script.

Tests: `tests/studio-optics.test.mjs` (optics) and `tests/studio-missions.test.mjs` (every お題
exists and passes or fails as it should, every label has both languages, and the English coach
never falls back to Japanese).

## Assets

`public/studio/` (about 43 MB, see its README). A place's panorama and HDR load only when it is
picked; the first view loads the garden and the bust (about 5 MB). Compressing the models
(Draco/KTX2) would be the next step if the size matters.
