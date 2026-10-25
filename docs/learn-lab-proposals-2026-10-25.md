# Learning-lab design proposals (2026-10-25)

Unpublished design proposals for rebuilding the "写真を触って学ぶ" pages, under `/learn/lab/`
(noindex, not linked from the site navigation). Six pages, five proposals each, coded for picking
(構成 A–E, 焦点 A–E, 露出 A–E, ボケ A–E, 被写体 A–E, 背景 A–E), plus a full-size prototype of
構成 A at `/learn/lab/studio/`.

## How the pictures are made

`src/scripts/lab/` is a small camera simulator shared by every proposal:

- `world.ts` — the set: a CC0 panorama projected onto the ground (`GroundedSkybox`) with its HDR
  for lighting, a subject, and optional props (procedural torii tunnel, pinwheel, falling leaves,
  a modelled studio sweep). Bright parts of the tone-mapped panorama are lifted so night lights
  turn into bokeh.
- `subjects.ts` — marble bust (eyes open), drawing mannequin (procedural), porcelain horse,
  tea set still life, classic camera, chess set.
- `pipeline.ts` — renders in linear HDR, averages subframes over the shutter time (motion blur and
  camera shake), applies depth of field from the depth buffer (single-pass scatter-as-gather with
  aperture-blade shapes), then exposure from the settings, ISO noise, and ACES tone mapping.
- `rig.ts` — where the camera stands (dolly framing that keeps the subject the same size, or a
  fixed distance), eased settings, tap-to-focus.
- `optics.ts` — exposure value, field of view, depth of field (tested in `tests/lab-optics.test.mjs`).

Assets live in `public/learn-lab/` (about 31 MB, see its README). Before shipping a chosen
proposal: compress the models (Draco/KTX2), drop unused ones, and add the English pages.

## Studio prototype 2 (構成 A, picked)

Picked: 構成 A (one studio, no page split) and 焦点 A's floor plan. `/learn/lab/studio/` was
rebuilt around that (`src/components/lab/StudioLab.astro`, `src/scripts/lab/studio/`):

- `gear.ts` — lens presets (kit zoom to 14mm F1.8 astro and a 1:1 macro) with a grade that sets
  fringing, corner softness, vignetting and flare; filters (ND8/64/1000, C-PL, soft, black and
  white mist, cross).
- `camera.ts` — tripod by default, a much gentler handheld shake, AF / tap AF / MF with peaking,
  closest focus distance, focus breathing and the exposure cost of magnification.
- `lights.ts` / `map.ts` — on-camera flash (TTL with exposure compensation, manual power, front or
  rear curtain, high-speed sync above 1/250) and up to three stand lights placed on the floor plan.
- `stars.ts` — a generated night sky (power-law star field, Milky Way, diurnal rotation about the
  pole, meteors); interval shooting stacks frames by lighten or average (`Stacker` in
  `pipeline.ts`).
- `flowers.ts` — a cosmos field and a detailed single cosmos for macro.
- `coach.ts` — plain advice with concrete numbers (明るすぎ, ISO, F値, 手ぶれ, ピント, 星, flash).
- `missions.ts` — eleven お題 (macro vs the whole field, Milky Way, star trails, meteors, sunstar…).

The panorama's JPEG clips the sun, so `world.ts` draws a small full-strength disc where the HDR
is brightest; lens flare, ghosts and the stopped-down sunstar come from it.

