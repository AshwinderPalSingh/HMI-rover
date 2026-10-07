export default async ({ page, sleep, shot, text, texts, check, errors, log }) => {
  await page.evaluateOnNewDocument(() => {
    window.__errors = [];
    window.addEventListener('error', (e) => window.__errors.push('error: ' + e.message));
    window.addEventListener('unhandledrejection', (e) => window.__errors.push('rejection: ' + (e.reason?.message || e.reason)));
    const ce = console.error.bind(console);
    console.error = (...a) => { window.__errors.push('console.error: ' + a.map(String).join(' ')); ce(...a); };
  });
  await page.goto('http://localhost:8097/', { waitUntil: 'networkidle2' });
  await page.waitForFunction(() => document.querySelector('.topbar__status')?.textContent.includes('Connected'), { timeout: 20000 });
  check('connects to rosbridge via /hmi-config.json port', true, await text('.topbar__status .pill:nth-child(1)'));
  await sleep(6000);
  const status = await texts('.topbar__status .pill');
  log('status pills:', status.join(' | '));
  check('localization reported', /AMCL|SLAM|Localized/.test(status[1] ?? ''), status[1]);
  const tiles = await texts('.robot-card .tile');
  log('robot card:', tiles.join(' | '));
  check('robot pose shown', /x\s*-?\d/.test(tiles[0] ?? ''), tiles[0]);
  const camBadge = await text('.cam-badge');
  check('camera live in Drive mode', !!camBadge && /fps/.test(camBadge), camBadge ?? 'no badge');
  const guard = await texts('.panel-body .pill');
  check('teleop guard detected', guard.some((g) => /Deadman active/.test(g)), guard.join(','));
  await shot('01_drive_1440');
  const errs = await errors();
  check('no console errors', errs.length === 0, errs.slice(0, 5).join(' || '));
};
