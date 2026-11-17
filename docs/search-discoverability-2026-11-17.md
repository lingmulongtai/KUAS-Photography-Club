# Search discoverability (2026-11-17)

## Implemented

- Astro's official sitemap integration enumerates prerendered public pages and excludes admin, API and error routes. `robots.txt` and the HTML head advertise `/sitemap-index.xml`.
- Japanese document titles use the Japanese club name; English titles retain the English name.
- Organization and WebSite JSON-LD identify this student-operated club, its canonical URL and existing Instagram identity. No unverified university endorsement, reviews or events are claimed.
- A first visit stays on the requested locale URL, even with an English browser. Explicit saved English choices still work. This avoids sending search-engine rendering away from Japanese pages.
- The 404 page is explicitly noindex.
- `verify-public-build.mjs` also verifies sitemap completeness, canonical and alternate targets, JSON-LD and the homepage title.

## After production deployment

1. In the existing Google Search Console property, inspect the homepage and submit `https://kuas-photography-club.vercel.app/sitemap-index.xml`. Request indexing for the homepage if appropriate. The website cannot fabricate Google's verification token or guarantee indexing.
2. Confirm official club social profiles link to the canonical website. A university club-directory link would be valuable, but contacting the university requires separate authorization. Do not confuse this club with a former club's pages.
3. Track branded queries such as `京都先端科学大学 写真部` and `KUAS Photography Club` using Search Console impressions, clicks, indexed pages and position. Search results vary; first place cannot be guaranteed and changes are not immediate.

## Scope

No robots access restrictions, account permissions, secrets, authentication, university claims or private member information were changed. Existing workflow/build validation remains in place and is run locally because GitHub Actions quota is exhausted. No emulator or new VM is used.
