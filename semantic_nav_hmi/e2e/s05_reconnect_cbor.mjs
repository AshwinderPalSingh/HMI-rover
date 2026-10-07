export default async ({ page, sleep, check, shot, log, texts, ros }) => {
  // 1. the open console should have reconnected on its own
  const ok = await page.waitForFunction(() => document.querySelector('.topbar__status')?.textContent.includes('Connected'), { timeout: 30000 }).then(() => true).catch(() => false);
  check('console auto-reconnects after the robot stack restarts', ok);
  const logRows = await page.evaluate(() => [...document.querySelectorAll('.statusbar__msg')].map((e) => e.textContent));
  log('status bar now:', logRows.join(' / '));

  // 2. fresh load: CBOR map must arrive fast with max_message_size raised
  await page.goto('http://localhost:8097/', { waitUntil: 'networkidle2' });
  await page.waitForFunction(() => document.querySelector('.topbar__status')?.textContent.includes('Connected'), { timeout: 20000 });
  const t0 = Date.now();
  await page.keyboard.press('2');
  await page.waitForFunction(() => document.querySelector('.stat-grid .tile')?.textContent.includes('2048'), { timeout: 20000 }).catch(() => {});
  const dt = (Date.now() - t0) / 1000;
  const tiles = await texts('.stat-grid .tile');
  check('map arrives over CBOR in < 5 s', /2048/.test(tiles[0] ?? '') && dt < 5, `${dt.toFixed(1)} s`);
  await sleep(2500);
  const warn = await page.evaluate(() => document.body.textContent.includes('No map over CBOR'));
  check('no JSON fallback needed', !warn);
  await shot('05_map_fit_1440');
  const scale = await page.$eval('.scalebar__label', (e) => e.textContent);
  log('scale bar:', scale);
  check('view auto-fits the explored map (scale >= 5 m)', /^(5|10|20|50) m$/.test(scale), scale);
};
