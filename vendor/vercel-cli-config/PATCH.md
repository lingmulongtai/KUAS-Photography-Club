# Local security patch for @vercel/cli-config

This directory contains the published `@vercel/cli-config` 0.3.1 package from
the npm registry (upstream tarball integrity:
`sha512-sISbygqlFXYb8qfPu/+2Cf/A8IjrlAuZePdag3EDQr2PRA455s7UZtl9Ro674CWsB/saBRmz3jEkw0YsQs8OoQ==`).
The upstream license is included in `LICENSE`.

The published root entry embeds Zod 4.1.11. To address
[GHSA-mrhx-c7xc-m3w5](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5),
this copy re-exports the package's published individual modules instead of the
bundled root entry, and resolves Zod 4.6.7. The package's build-only scripts
and dev dependencies have been removed, and the published `dist` files have
been placed under `lib` with matching package exports; the other shipped
modules and types remain unchanged. The root dependency and npm override ensure that OIDC uses
this same local package. `tests/vercel-cli-config.test.mjs` checks the entry,
public exports, security behavior, and configuration compatibility.

Remove this copy, the root dependency, and its override when Vercel publishes
a compatible `@vercel/cli-config` whose bundled Zod includes the fix, and its
dependent packages can resolve that release. Re-run the compatibility tests.
