# Learning illustrations and development samples

The placeholder pictures are drawn by `painters.js` and generated into `public/photos/samples/`. They are program-drawn illustrations, not club photographs or activity records. Learning demonstrations (including the labelled darkroom illustration on the 404 page) may use them with a visible explanation of their purpose.

All six shipped trip entries are development samples. `sample: true` and `draft: true` entries are excluded from public collections, detail routes, map previews, film strips and admin initial data. Do not remove the flag to make an unverified trip look real.

When adding a real record:

1. Confirm the activity date, report and any participant count using an actual record.
2. Check publication conditions for the photographer, people depicted and facilities. Exhibition or sale submission is not website permission.
3. Put approved images in `public/photos/<trip-slug>/`, then create a record with accurate metadata. Use only a publicly approved name or display name in `by`.
4. Verify the rendered record, credits and all public routes. Retain the development samples separately if useful; do not repurpose invented dates or reports as real events.

The existing learning illustrations remain in use. Do not delete their files merely because sample trip records are hidden.

To regenerate illustrations in a local environment with Playwright and Chromium already available:

```sh
node tools/sample-photos/generate.mjs
```
