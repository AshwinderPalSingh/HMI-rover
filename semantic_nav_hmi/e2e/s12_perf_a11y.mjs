export default async ({ page, sleep, check, log }) => {
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
  await page.goto('http://localhost:8097/', { waitUntil: 'networkidle2' });
  await page.waitForFunction(() => document.querySelector('.topbar__status')?.textContent.includes('Connected'), { timeout: 20000 });
  const cdp = await page.target().createCDPSession();
  await cdp.send('Performance.enable');
  const busy = async (mode, secs = 10) => {
    await page.keyboard.press(mode);
    await sleep(3000);
    const m0 = Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((m) => [m.name, m.value]));
    await sleep(secs * 1000);
    const m1 = Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((m) => [m.name, m.value]));
    const pct = ((m1.TaskDuration - m0.TaskDuration) / secs) * 100;
    const script = ((m1.ScriptDuration - m0.ScriptDuration) / secs) * 100;
    return { pct, script, heapMB: m1.JSHeapUsedSize / 1e6 };
  };
  const mapIdle = await busy('2');
  log(`Map mode idle: main thread ${mapIdle.pct.toFixed(1)}% (script ${mapIdle.script.toFixed(1)}%), heap ${mapIdle.heapMB.toFixed(0)} MB`);
  check('map mode, robot idle: main thread < 25% (software-rendered headless)', mapIdle.pct < 25, `${mapIdle.pct.toFixed(1)}%`);
  const drive = await busy('1');
  log(`Drive mode (15 fps camera): main thread ${drive.pct.toFixed(1)}% (script ${drive.script.toFixed(1)}%), heap ${drive.heapMB.toFixed(0)} MB`);
  check('drive mode with live camera: main thread < 40%', drive.pct < 40, `${drive.pct.toFixed(1)}%`);

  // accessibility: every interactive element has an accessible name
  const unnamed = await page.evaluate(() => {
    const name = (el) => (el.getAttribute('aria-label') || el.textContent || el.getAttribute('title') || (el.id && document.querySelector(`label[for="${el.id}"]`)?.textContent) || el.closest('label')?.textContent || '').trim();
    return [...document.querySelectorAll('button, a[href], input, select, textarea, [role="button"], canvas[role]')]
      .filter((el) => el.offsetParent !== null && !name(el))
      .map((el) => el.outerHTML.slice(0, 100));
  });
  check('all visible controls have an accessible name', unnamed.length === 0, unnamed.slice(0, 3).join(' | '));
};
