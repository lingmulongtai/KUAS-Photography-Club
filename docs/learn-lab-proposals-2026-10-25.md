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
