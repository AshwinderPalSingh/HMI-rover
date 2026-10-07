import { calibrate, robotPose } from './lib.mjs';
export default async ({ page, sleep, check, shot, log }) => {
  await page.goto('http://localhost:8097/', { waitUntil: 'networkidle2' });
  await page.waitForFunction(() => document.querySelector('.topbar__status')?.textContent.includes('Connected'), { timeout: 20000 });
  await page.keyboard.press('1');
  await sleep(800);
  // Settings: switch the camera topic
  await page.click('button[aria-label="Settings"]');
  await page.waitForSelector('#set-camera');
  await shot('10_settings_1440');
  await page.focus('#set-camera');
  await page.keyboard.down('Control'); await page.keyboard.press('KeyA'); await page.keyboard.up('Control');
  await page.type('#set-camera', '/e2e_cam/compressed');
  await page.evaluate(() => [...document.querySelectorAll('.dialog__foot button')].find((b) => b.textContent === 'Save').click());
  await page.waitForFunction(() => /fps/.test(document.querySelector('.cam-badge')?.textContent ?? ''), { timeout: 15000 }).catch(() => {});
  await sleep(1500);
  const badge = await page.$eval('.cam-badge', (e) => e.textContent).catch(() => '');
  check('camera re-subscribes to the new topic from Settings', /640×360/.test(badge), badge);
  // sample the four quadrants on the canvas
  const px = await page.evaluate(() => {
    const g = document.querySelector('.stage__primary .cameraview canvas');
    // WebGL or 2D: read it back through a 2D copy
    const c = document.createElement('canvas'); c.width = g.width; c.height = g.height;
    const ctx = c.getContext('2d'); ctx.drawImage(g, 0, 0);
    // the frame is letterboxed (contain): compute drawn rect
    const s = Math.min(c.width / 640, c.height / 360);
    const w = 640 * s, h = 360 * s, x0 = (c.width - w) / 2, y0 = (c.height - h) / 2;
    const at = (fx, fy) => Array.from(ctx.getImageData(Math.round(x0 + fx * w), Math.round(y0 + fy * h), 1, 1).data).slice(0, 3);
    return { tl: at(0.25, 0.6 * 0.5), tr: at(0.75, 0.3), bl: at(0.25, 0.75), br: at(0.75, 0.75) };
  });
  log('quadrants rgb:', JSON.stringify(px));
  const near = (a, b) => a.every((v, i) => Math.abs(v - b[i]) < 40);
  check('colours and orientation are correct (R TL, G TR, B BL, W BR)', near(px.tl, [255, 0, 0]) && near(px.tr, [0, 255, 0]) && near(px.bl, [0, 0, 255]) && near(px.br, [255, 255, 255]), JSON.stringify(px));
  await shot('10_testpattern_1440');
  // restore
  await page.click('button[aria-label="Settings"]');
  await page.waitForSelector('#set-camera');
  await page.focus('#set-camera');
  await page.keyboard.down('Control'); await page.keyboard.press('KeyA'); await page.keyboard.up('Control');
  await page.type('#set-camera', '/chase_camera/image_raw/compressed');
  await page.evaluate(() => [...document.querySelectorAll('.dialog__foot button')].find((b) => b.textContent === 'Save').click());
  await sleep(500);

  // AMCL pose estimate tool
  await page.keyboard.press('2');
  await sleep(1500);
  const { toScreen } = await calibrate(page);
  const p0 = await robotPose(page);
  const t = { x: p0.x + 0.6, y: p0.y };
  const s1 = toScreen(t.x, t.y);
  await page.keyboard.press('p');
  await page.mouse.move(s1.x, s1.y); await page.mouse.down(); await page.mouse.move(s1.x + 40, s1.y, { steps: 4 }); await page.mouse.up();
  await sleep(2500);
  const p1 = await robotPose(page);
  log('pose before', p0, 'after estimate', p1);
  check('pose estimate tool relocalizes AMCL', Math.abs(p1.x - t.x) < 0.25 && Math.abs(p1.y - t.y) < 0.25, `(${p1.x}, ${p1.y}) vs (${t.x.toFixed(2)}, ${t.y.toFixed(2)})`);
  // put it back
  const s0 = toScreen(p0.x, p0.y);
  await page.mouse.move(s0.x, s0.y); await page.mouse.down(); await page.mouse.move(s0.x + 40, s0.y, { steps: 4 }); await page.mouse.up();
  await sleep(1500);
  await page.keyboard.press('Escape');
};
