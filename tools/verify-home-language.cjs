// Run against a production build served locally. Use the same Playwright installation as the other 3D checks.
const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

const base = process.argv[2] || 'http://127.0.0.1:4321';
const selector = '.site-header .language-switch';
const ready = '.hero.is-ready:not(.no-3d)';
const date = new Date(Date.now() + 86400000).toISOString().slice(0, 10);

function trackRequests(page) {
  const documents = [], scenery = [], errors = [];
  let lastScenery = 0;
  page.on('request', req => {
    if (req.isNavigationRequest() && req.frame() === page.mainFrame()) documents.push(req.url());
    const path = new URL(req.url()).pathname;
    if (path.startsWith('/kyoto/')) { scenery.push(path); lastScenery = Date.now(); }
  });
  page.on('pageerror', error => errors.push(error.message));
  return { documents, scenery, errors, get quiet() { return Date.now() - lastScenery; } };
}

async function explore(browser) {
  const page = await browser.newPage({ viewport: { width: 1180, height: 720 }, reducedMotion: 'reduce' });
  try {
    const requests = trackRequests(page);
    // Three's own devtools event exposes the actual renderer. Observe the 3D camera used for a frame.
    await page.addInitScript(() => {
      window.__THREE_DEVTOOLS__ = new EventTarget();
      window.__THREE_DEVTOOLS__.addEventListener('observe', ({ detail: renderer }) => {
        if (!renderer.isWebGLRenderer || !renderer.domElement.closest('.hero-stage')) return;
        window.heroRenderer = renderer;
        const render = renderer.render;
        renderer.render = function (scene, camera) {
          if (camera.isPerspectiveCamera) window.heroCamera = camera;
          return render.call(this, scene, camera);
        };
      });
    });
    await page.route('**/api/schedule.json*', route => route.fulfill({ json: {
      events: [{ date, kind: 'meeting', time: '18:00', title: '撮影ミーティング', titleEn: 'Photo meeting' }],
      updatedAt: new Date().toISOString()
    } }));
    await page.goto(new URL('/?view=inariRidge&fps=1#main', base).href, { waitUntil: 'domcontentloaded' });
    await page.locator(ready).waitFor({ timeout: 90000 });
    await page.waitForFunction(() => !document.querySelector('.hero-intro').open && window.heroCamera);
    await page.locator('.explore-toggle').click();
    await page.locator('#sky-time').fill('1110');
    await page.locator('[data-season]').selectOption('autumn');
    await page.locator('[data-frame-record]').click();
    // Move off the opening pose before checking that language and history retain the chosen position.
    const opening = await page.evaluate(() => window.heroCamera.position.toArray());
    await page.locator('.hero-stage').focus();
    await page.keyboard.down('w');
    try {
      await page.waitForFunction(start => window.heroCamera.position.distanceToSquared({ x: start[0], y: start[1], z: start[2] }) > 1, opening);
    } finally { await page.keyboard.up('w'); }
    // Start the drag on the scene, clear of its floating controls.
    const beforeTurn = await page.evaluate(() => window.heroCamera.quaternion.toArray());
    const point = await page.evaluate(() => {
      for (let y = 150; y < innerHeight - 45; y += 40) {
        for (let x = 100; x < innerWidth - 120; x += 55) {
          if (document.elementFromPoint(x, y)?.matches('.hero-stage, .hero-stage > canvas')) return { x, y };
        }
      }
    });
    assert.ok(point, 'scene must have a draggable area');
    await page.mouse.move(point.x, point.y);
    await page.mouse.down();
    await page.mouse.move(point.x + 90, point.y + 20, { steps: 4 });
    await page.mouse.up();
    await page.waitForFunction(start => window.heroCamera.quaternion.toArray().some((n, i) => Math.abs(n - start[i]) > .001), beforeTurn);
    await page.waitForFunction(() => document.querySelector('.hero-pin .pin-trigger') && document.querySelector('[data-calendar-content]').textContent.includes('撮影ミーティング'));
    const deadline = Date.now() + 30000;
    while (requests.quiet < 1300 && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 150));
    assert.ok(requests.quiet >= 1300, 'initial Kyoto requests did not settle');
    assert.ok(requests.scenery.includes('/kyoto/terrain.json'));
    const count = requests.scenery.length;
    await page.evaluate(() => {
      const renderer = window.heroRenderer, camera = window.heroCamera;
      window.baseline = { document, renderer, camera, canvas: renderer.domElement, gl: renderer.getContext(),
        matrix: camera.matrixWorld.toArray(), pin: document.querySelector('.hero-pin .pin-trigger'),
        reel: document.querySelector('[data-reel-ring] [data-slot]') };
      window.introReopened = 0;
      new MutationObserver(records => {
        window.introReopened += records.filter(change => change.oldValue === null).length;
      }).observe(document.querySelector('.hero-intro'), { attributeFilter: ['open'], attributeOldValue: true });
    });

    async function check(lang) {
      await page.waitForFunction(expected => document.documentElement.lang === expected, lang);
      const en = lang === 'en', path = en ? '/en/' : '/';
      assert.equal(new URL(page.url()).pathname, path);
      assert.equal(new URL(page.url()).search + new URL(page.url()).hash, '?view=inariRidge&fps=1#main');
      const state = await page.evaluate(() => {
        const b = window.baseline;
        if (!b) return {};
        const q = s => document.querySelector(s);
        return {
          same: document === b.document && window.heroRenderer === b.renderer && window.heroCamera === b.camera &&
            q('.hero-stage canvas') === b.canvas && b.renderer.getContext() === b.gl && !b.gl.isContextLost() &&
            q('.hero-pin .pin-trigger') === b.pin && q('[data-reel-ring] [data-slot]') === b.reel,
          delta: Math.max(...window.heroCamera.matrixWorld.elements.map((v, i) => Math.abs(v - b.matrix[i]))),
          intro: window.introReopened, view: q('.views [aria-pressed="true"]').dataset.view,
          explore: q('.explore-toggle').textContent, clock: q('[data-clock]').textContent, season: q('[data-season]').value,
          pin: b.pin.getAttribute('aria-label'), moon: q('[data-moon]').textContent,
          recording: q('[data-frame-record]').getAttribute('aria-pressed'), recordText: q('[data-frame-record]').textContent,
          canonical: new URL(q('[rel="canonical"]').href).pathname, title: document.title,
          reel: b.reel.getAttribute('aria-label')
        };
      });
      assert.ok(state.same, 'document, canvas, renderer, camera, pins or reel were replaced');
      assert.ok(state.delta < 1e-6, 'camera moved when switching language: ' + state.delta);
      assert.equal(state.intro, 0);
      assert.equal(state.canonical, path); assert.ok(state.title);
      assert.equal(state.view, 'inariRidge'); assert.equal(state.clock, '18:30'); assert.equal(state.season, 'autumn');
      assert.equal(state.explore, en ? 'Exit exploration' : '散策を終了');
      assert.equal(state.recording, 'true'); assert.equal(state.recordText, en ? 'Stop & save CSV' : '停止してCSV保存');
      assert.match(state.pin, en ? /Explore/ : /近づく/); assert.match(state.moon, en ? /Moon age/ : /月齢/);
      await page.waitForFunction(title => document.querySelector('[data-calendar-content]').textContent.includes(title), en ? 'Photo meeting' : '撮影ミーティング');
      return state;
    }
    await page.locator(selector).click();
    const en = await check('en');
    await page.locator(selector).click();
    const ja = await check('ja');
    assert.notEqual(en.title, ja.title); assert.notEqual(en.reel, ja.reel);
    await page.goBack(); await check('en');
    await page.goForward(); await check('ja');
    assert.deepEqual(requests.documents.length, 1);
    assert.deepEqual(requests.scenery.slice(count), []);
    assert.deepEqual(requests.errors, []);
    console.log('稲荷山での散策と履歴往復', { initialKyotoRequests: count, extraDocuments: 0, extraKyotoRequests: 0, cameraMatrixDelta: ja.delta, introReopened: ja.intro });
  } finally { await page.close(); }
}

async function switchDuringLoad(browser) {
  const page = await browser.newPage({ viewport: { width: 390, height: 780 }, isMobile: true, hasTouch: true });
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  try {
    const requests = trackRequests(page);
    await page.addInitScript(() => {
      Object.defineProperty(window, 'localStorage', { get() { throw new DOMException('Blocked', 'SecurityError'); } });
    });
    await page.route('**/kyoto/terrain.json', async route => { await gate; await route.continue(); });
    await page.route('**/api/schedule.json*', route => route.fulfill({ json: { events: [], updatedAt: new Date().toISOString() } }));
    const firstTerrain = page.waitForRequest('**/kyoto/terrain.json', { timeout: 60000 });
    await page.goto(new URL('/en/?view=inariRidge', base).href, { waitUntil: 'domcontentloaded' });
    await firstTerrain;
    await page.waitForFunction(() => !document.querySelector('.hero-intro').open);
    assert.equal(await page.locator(ready).count(), 0);
    await page.evaluate(() => { window.pendingTerrainCanvas = document.querySelector('.hero-stage canvas'); });
    await page.locator(selector).click();
    assert.equal(new URL(page.url()).pathname, '/');
    assert.equal(new URL(page.url()).searchParams.get('lang'), 'ja');
    release();
    await page.locator(ready).waitFor({ timeout: 90000 });
    await page.waitForFunction(() => document.querySelector('.hero-pin .pin-trigger')?.getAttribute('aria-label').includes('近づく'));
    assert.ok(await page.evaluate(() => window.pendingTerrainCanvas === document.querySelector('.hero-stage canvas')));
    assert.equal(requests.documents.length, 1);
    assert.equal(requests.scenery.filter(p => p === '/kyoto/terrain.json').length, 1);
    assert.deepEqual(requests.errors, []);
    console.log('スマホ幅で地形取得中に切替', { documents: 1, terrainRequests: 1, localeAfterLoad: 'ja' });
  } finally { release(); await page.close(); }
}

(async () => {
  const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined });
  try { await explore(browser); await switchDuringLoad(browser); }
  finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
