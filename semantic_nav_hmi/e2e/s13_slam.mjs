export default async ({ page, sleep, check, shot, log, texts }) => {
  await page.goto('http://localhost:8097/', { waitUntil: 'networkidle2' });
  await page.waitForFunction(() => document.querySelector('.topbar__status')?.textContent.includes('Connected'), { timeout: 20000 });
  await page.keyboard.press('2');
  await page.waitForFunction(() => /SLAM active/.test(document.querySelector('.panel-body')?.textContent ?? ''), { timeout: 20000 }).catch(() => {});
  const head = await page.$eval('.panel-body .section-head', (e) => e.textContent);
  check('Map mode detects SLAM', /SLAM active/.test(head), head);
  const chips = await texts('.topbar__status .pill');
  check('localization chip reports SLAM', /SLAM/.test(chips[1] ?? ''), chips[1]);
  await page.waitForFunction(() => /\d+ × \d+/.test(document.querySelector('.stat-grid .tile')?.textContent ?? ''), { timeout: 20000 }).catch(() => {});
  const t0 = await texts('.stat-grid .tile');
  log('map before driving:', t0[0], '|', t0[1]);
  // drive to explore
  await page.keyboard.down('w');
  await sleep(4000);
  await page.keyboard.up('w');
  await page.keyboard.down('a');
  await sleep(2500);
  await page.keyboard.up('a');
  await sleep(7000); // SLAM map_update_interval is 5 s
  const t1 = await texts('.stat-grid .tile');
  log('map after driving:', t1[0], '|', t1[1], '|', t1[2]);
  const area = (t) => Number((t.match(/([\d,]+) m²/) || [, '0'])[1].replace(/,/g, ''));
  check('SLAM map grows while driving (live updates over CBOR)', area(t1[1]) > area(t0[1]), `${area(t0[1])} → ${area(t1[1])} m²`);
  check('last update is recent', /just now|\d s ago/.test(t1[2]), t1[2]);
  await shot('13_slam_1440');
  // save
  const dirSel = '#map-dir';
  await page.focus(dirSel);
  await page.keyboard.down('Control'); await page.keyboard.press('KeyA'); await page.keyboard.up('Control');
  await page.type(dirSel, process.env.E2E_DIR);
  await page.focus('#map-name');
  await page.keyboard.down('Control'); await page.keyboard.press('KeyA'); await page.keyboard.up('Control');
  await page.type('#map-name', 'e2e_map');
  await page.evaluate(() => [...document.querySelectorAll('.card button')].find((b) => /Save map/.test(b.textContent)).click());
  await page.waitForSelector('.result-list', { timeout: 30000 }).catch(() => {});
  const res = await texts('.result-list li');
  log('save results:', res.join(' | '));
  check('console reports both artifacts saved', res.length === 2 && /Occupancy grid .*\.yaml/.test(res[0]) && /Pose graph .*\.posegraph/.test(res[1]), res.join(' | '));
  await shot('13_saved_1440');
};
