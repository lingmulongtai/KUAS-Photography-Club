# Themes, Google Calendar and southern Kyoto — 2026-10-20

## Behavior

- Light remains the default even on a dark device. The header offers light, dark navy and OLED black. An explicit choice persists locally across routes and Japanese/English changes. No device preference is sent to a server.
- Free exploration accepts Ctrl/Command+wheel as bounded optical zoom. Plain wheel still approaches the scenery. Mobile pinch behavior is retained.
- Each new scene selects one of three cloud characters (cumulus-like heaps, thin wisps or broader sheets), with a seed, coverage and wind chosen once. Clouds drift smoothly; a time preset also advances/reverses their pattern. Reduced motion stops ambient drift. These are illustrative weather, not live observations.
- The Kiyomizu blue beam now originates east of the main hall on the mountain side. This point is inferred from the official image/map, not surveyed lamp coordinates.
- Added the Kameoka Kiri Terrace panorama at Ryugao-yama, Fushimi Inari halls and two torii corridors, Byodoin Phoenix Hall and an Uji destination, and the Sewaritei three-river panorama toward Osaka.

## Google Calendar

The organizer-supplied public calendar is the primary schedule. Read-only public ICS needs neither a Cloud API key nor OAuth. Visitors receive selected fields only: title, date, kind, time and place. Attendees, organizer details, descriptions, private/confidential events and cancelled instances are excluded.

`/api/schedule.json` parses actual recurrence rules, excluded dates and moved instances, using JST for timed events and floating dates for all-day events. All-day ends are exclusive; overnight entries show their explicit date range. The visible window starts with the current JST month and spans twelve months. Old ongoing entries are clipped into that window. Feed size, expansion frequency and output count are bounded.

The endpoint caches for one minute; the visible page requests an update every minute and when resumed. CDN stale revalidation and Google's feed publication can add delay, so this is not an immediate-sync guarantee. Failure leaves the confirmed fallback/last rendered dates and a direct Google Calendar link. No future meetings are invented. The explicitly confirmed 2026-10-23 cancellation remains authoritative over accidental recurring meeting entries.

The admin page links straight to Google Calendar. Its old monthly editor is clearly identified as fallback content only. The integration does not change the calendar's sharing permissions or write any events. New future dates added to the supplied calendar were observed on the local homepage without a site rebuild; the deployed preview endpoint also returned future dates.

## Geography and quality boundaries

- Fushimi Inari uses mapped OSM outlines for the gate, outer/inner worship halls, main shrine and inner shrine. The two torii corridors follow OSM ways 260121328 and 377968455. Heights, small joinery and torii spacing are approximate visual interpretations.
- Phoenix Hall follows the official 47 m north–south span, 35 m east–west depth and 13.5 m main-roof height excluding phoenixes. Orientation and placement use OSM way 100296031. Details remain a low-poly interpretation.
- Uji adds 81,082 GSI building outlines with representative 6 m/10 m heights, roads, railways, water and aerial imagery. These are not measured building heights. Only the visited additional region is kept active. Close aerial detail around Phoenix Hall is bounded to 1.4 km square, with a smaller mobile image, reusing the existing terrain photo slot.
- Kiri Terrace is OSM viewpoint node 6855829264 (34.9926914, 135.5615125). Sewaritei uses the Sakura Deaikan viewpoint node 10300134954. These are elevated camera compositions rather than a surveyed physical eye height.

## Validation

- 133 regression tests passed. Calendar behavior was also run in JST and UTC, including recurrence overrides, exclusions, privacy, cancellations, all-day boundaries, overnight entries, ongoing long events and over-dense rules.
- Astro check: 226 files, zero errors/warnings/hints. Production build and 52 static routes/public-content/link checks passed from an ASCII worktree at the same source commit. The Japanese OneDrive path triggered a Windows native-process failure, so it was not used as the acceptance build.
- Real WebGL compilation/rendering passed for all three cloud characters, forest, snow, railway and beam shaders. New shrine/hall geometry is finite and bounded, with replacement masks and mapped navigation tested.
- Browser verification: opt-in navy/black and light default under emulated dark OS; 390 px layout without horizontal overflow; theme retained through English navigation; mobile menu operation; Fushimi Inari/Phoenix Hall/Kiri Terrace rendering. The exploration event path changed perspective scale by 1.34986x while page scale stayed 1 and scroll stayed 0; this used a synthetic wheel event through the real page handler.
- Physical phone/iOS/Safari acceptance and field dimensions were not tested. A third-party Instagram iframe logged its own route-config error during one local visit; the club's embed integration was unchanged.
- `npm audit` reports three inherited high advisories through the existing Vercel adapter's path-to-regexp dependency. The new calendar dependency is not the reported source; no unrelated adapter downgrade or forced dependency rewrite was performed.

## Sources

- [Google public-calendar help](https://support.google.com/calendar/answer/37083?hl=en), [node-ical recurrence documentation](https://github.com/jens-maus/node-ical#expanding-recurring-events)
- [Fushimi Inari official precinct map](https://inari.jp/trip/map01/)
- [Byodoin official dimensions](https://www.byodoin.or.jp/faq/byodoin/), [architecture](https://www.byodoin.or.jp/learn/architecture/)
- [Kameoka city: Kiri Terrace](https://www.city.kameoka.kyoto.jp/site/kankou/3553.html)
- [Kiyomizu official night viewing](https://www.kiyomizudera.or.jp/event/yakan.php), [reference photograph](https://www.kiyomizudera.or.jp/assets/img/event/night_ph_07.jpg), [precinct map](https://www.kiyomizudera.or.jp/map.php)
- [GSI tile sources](https://maps.gsi.go.jp/development/ichiran.html), [OpenStreetMap attribution](https://www.openstreetmap.org/copyright). Existing on-site source credits are retained.

## Atomic implementation commits

Subjects state each commit's purpose. Documentation and any later validation corrections are included in the complete [PR commit sequence](https://github.com/lingmulongtai/KUAS-Photography-Club/pull/9/commits). History is preserved with a merge commit.

| SHA | Purpose / subject |
| --- | --- |
| `a40807a` | feat(theme): offer opt-in navy and OLED themes while keeping light as default |
| `cdd5691` | build(calendar): add timezone-aware iCalendar recurrence parsing |
| `00c6e0e` | feat(hero): zoom the exploration camera with Ctrl or Command wheel |
| `2c3eb19` | feat(schedule): serve the public Google calendar with recurrence and cancellation support |
| `200dbc8` | feat(schedule): refresh Japanese and English calendars without redeploying |
| `47b9f3b` | feat(hero): vary cloud weather each visit and follow time travel |
| `649a2cc` | feat(hero): overlook Kameoka campus from Kiri Terrace |
| `a74b92c` | fix(hero): originate the Kiyomizu blue beam from the mountain side |
| `c4565d1` | feat(kyoto): fill Uji with bounded building river and aerial data |
| `ec449fd` | test(hero): render every cloud character through the production shader |
| `f878f4c` | feat(hero): model Fushimi Inari halls and twin torii corridors |
| `311d254` | feat(hero): build Byodoin Phoenix Hall and add an Uji destination |
| `fc012a8` | feat(hero): look toward Osaka from Sewaritei and the river confluence |
| `cc7d325` | fix(schedule): show the full date range for overnight events |
| `1782cb0` | fix(schedule): bound recurrence expansion and retain ongoing events |
| `70b1df2` | fix(hero): keep cloud drift smooth between time selections |
| `ea95be2` | fix(theme): retain contrast on hero and campus hover controls |
| `bfec720` | feat(admin): make Google Calendar the direct schedule editing path |
| `ae2ad67` | fix(hero): retain the JST date dependency for seasonal rendering |
| `3fb16d1` | feat(kyoto): sharpen Phoenix Hall grounds with local aerial detail |
| `e58eeba` | fix(a11y): name the compact mobile menu control |
