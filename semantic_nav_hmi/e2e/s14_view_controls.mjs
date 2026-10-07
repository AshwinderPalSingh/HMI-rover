export default async ({ page, sleep, check, shot, log }) => {
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
  await page.goto('http://localhost:8097/', { waitUntil: 'networkidle2' });
  await page.evaluate(() => localStorage.removeItem('semantic-nav-hmi:pip'));
  await page.goto('http://localhost:8097/', { waitUntil: 'networkidle2' });
  await page.waitForFunction(() => document.querySelector('.topbar__status')?.textContent.includes('Connected'), { timeout: 20000 });
  await page.keyboard.press('1');
  await page.waitForFunction(() => /fps/.test(document.querySelector('.cam-badge')?.textContent ?? ''), { timeout: 15000 });
  const cam = await page.$eval('.stage__primary .cameraview canvas', (c) => { const r = c.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
  const badge = () => page.$eval('.cam-badge', (e) => e.textContent);

  // 1. wheel zoom on the camera
  await page.mouse.move(cam.x + 100, cam.y + 50);
  await page.mouse.wheel({ deltaY: -400 });
  await sleep(400);
  const b1 = await badge();
  check('mouse wheel zooms the camera view', /\d\.\d×/.test(b1), b1);
  await shot('zoom_camera_zoomed');
  // 2. drag pans while zoomed: the image under a fixed screen point must change
  const sample = () => page.evaluate(({ x, y }) => {
    const c = document.querySelector('.stage__primary .cameraview canvas');
    const r = c.getBoundingClientRect();
    const k = c.width / r.width;
    return Array.from(c.getContext('2d').getImageData(Math.round((x - r.x) * k), Math.round((y - r.y) * k), 1, 1).data).join(',');
  }, { x: cam.x - 200, y: cam.y + 120 });
  const z0 = await page.evaluate(() => document.querySelector('.cam-badge').textContent);
  await page.mouse.move(cam.x, cam.y);
  await page.mouse.down();
  await page.mouse.move(cam.x + 160, cam.y + 90, { steps: 8 });
  await page.mouse.up();
  await sleep(300);
  check('drag pans the zoomed camera view (zoom unchanged)', (await badge()).includes(z0.match(/\d\.\d×/)?.[0] ?? '?'), await badge());
  // 3. keyboard: 0 resets, + zooms when the camera is in front
  await page.keyboard.press('0');
  await sleep(300);
  check('0 resets camera zoom', !/×/.test((await badge()).split('fps')[1] ?? ''), await badge());
  await page.keyboard.press('+');
  await sleep(300);
  check('+ zooms the camera when it is the main view', /1\.4×/.test(await badge()), await badge());
  await page.mouse.click(cam.x, cam.y, { count: 2 });
  await sleep(300);
  check('double-click resets', !/\d\.\d×/.test(await badge()), await badge());

  // 4. PiP: drag by its bar to the bottom-left
  const pip = () => page.$eval('.pip', (e) => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
  const p0 = await pip();
  const bar = await page.$eval('.pip__bar .pip__title', (e) => { const r = e.getBoundingClientRect(); return { x: r.x + 10, y: r.y + r.height / 2 }; });
  await page.mouse.move(bar.x, bar.y);
  await page.mouse.down();
  await page.mouse.move(bar.x - 650, bar.y + 500, { steps: 12 });
  await page.mouse.up();
  await sleep(300);
  const p1 = await pip();
  check('PiP can be dragged to another corner', p1.x < p0.x - 400 && p1.y > p0.y + 300, `(${p0.x},${p0.y}) → (${p1.x},${p1.y})`);
  // 5. resize with the grip
  const grip = await page.$eval('.pip__grip', (e) => { const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
  await page.mouse.move(grip.x, grip.y);
  await page.mouse.down();
  await page.mouse.move(grip.x + 160, grip.y, { steps: 8 });
  await page.mouse.up();
  await sleep(300);
  const p2 = await pip();
  check('PiP can be resized from its corner', p2.w > p1.w + 100, `${p1.w} → ${p2.w} px wide`);
  await shot('zoom_pip_moved');
  // 6. persists across reload
  await page.reload({ waitUntil: 'networkidle2' });
  await page.waitForFunction(() => document.querySelector('.topbar__status')?.textContent.includes('Connected'), { timeout: 20000 });
  await sleep(800);
  const p3 = await pip();
  check('PiP position and size are remembered', Math.abs(p3.x - p2.x) < 3 && Math.abs(p3.w - p2.w) < 3, `(${p3.x},${p3.y}) ${p3.w}px`);
  // 7. click PiP body swaps views
  await page.click('.pip__body');
  await sleep(600);
  check('clicking the PiP swaps the views', await page.$('.stage__primary .mapview') !== null);
  // 8. map still zooms with the wheel
  const scale0 = await page.$eval('.scalebar__label', (e) => e.textContent);
  const mv = await page.$eval('.stage__primary .mapview canvas', (c) => { const r = c.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
  await page.mouse.move(mv.x, mv.y);
  await page.mouse.wheel({ deltaY: -600 });
  await sleep(400);
  const scale1 = await page.$eval('.scalebar__label', (e) => e.textContent);
  check('map wheel zoom still works', scale0 !== scale1, `${scale0} → ${scale1}`);
  // tidy up
  await page.evaluate(() => localStorage.removeItem('semantic-nav-hmi:pip'));
};
