# Sample photos

The trips that ship with the site use painted placeholder pictures, not real
photos. They are drawn by `painters.js` and written to `public/photos/samples/`
by `generate.mjs`.

When the club adds real photos:

1. Put them in `public/photos/<trip-slug>/` (JPEG, about 1600 px on the long side).
2. Point the trip's `photos` list in `src/content/trips/<trip-slug>.md` at them,
   with the photographer's name in `by` (see guideline §6 for credit rules).
3. Delete `sample: true` from the trip, and remove its folder under
   `public/photos/samples/` once nothing uses it.

To regenerate the placeholders:

```sh
npm i -D playwright && npx playwright install chromium
node tools/sample-photos/generate.mjs
```
