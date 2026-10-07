// Views: the simulation's 3D view navigates like the Gazebo GUI, other cameras zoom digitally,
// the picture-in-picture can be moved, resized and swapped, and the map still zooms.
const snapshotJs = `(() => { const c = document.querySelector('.stage__primary .cameraview canvas'); const t = document.createElement('canvas'); t.width = c.width; t.height = c.height; t.getContext('2d').drawImage(c, 0, 0); return t; })()`;

export default async ({ page, sleep, check, shot, log, ros }) => {
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
  await page.goto('http://localhost:8097/', { waitUntil: 'networkidle2' });
  await page.evaluate(() => { localStorage.removeItem('semantic-nav-hmi:pip'); localStorage.removeItem('hint.orbit.dismissed'); });
  await page.goto('http://localhost:8097/', { waitUntil: 'networkidle2' });
  await page.waitForFunction(() => document.querySelector('.topbar__status')?.textContent.includes('Connected'), { timeout: 20000 });
  await page.keyboard.press('1');
  await page.waitForFunction(() => /3D view.*fps/.test(document.querySelector('.cam-badge')?.textContent ?? ''), { timeout: 15000 });
  await sleep(800);
  const cam = await page.$eval('.stage__primary .cameraview canvas', (c) => { const r = c.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
  const badge = () => page.$eval('.cam-badge', (e) => e.textContent);
  const state = () => {
    const out = ros('timeout 8 ros2 topic echo --once --qos-durability transient_local --qos-reliability reliable /viewer_camera/state 2>/dev/null', 12000);
    const num = (k) => Number((out.match(new RegExp(`^\\s*${k}:\\s*(-?[\\d.e-]+)`, 'm')) || [, 'NaN'])[1]);
    const off = out.match(/offset:\s*\n\s*x:\s*(-?[\d.e-]+)\s*\n\s*y:\s*(-?[\d.e-]+)/);
    return { az: num('azimuth'), el: num('elevation'), d: num('distance'), ox: off ? Number(off[1]) : NaN, oy: off ? Number(off[2]) : NaN, follow: /follow_heading: true/.test(out) };
  };
  const fmt = (s) => `az ${s.az.toFixed(2)} el ${s.el.toFixed(2)} d ${s.d.toFixed(2)} off (${s.ox.toFixed(2)}, ${s.oy.toFixed(2)})${s.follow ? '' : ' world-fixed'}`;
  const webgl = await page.$eval('.stage__primary .cameraview canvas', (c) => !!c.getContext('webgl'));
  log(webgl ? 'camera renders with WebGL (prediction on)' : 'no hardware WebGL: 2D canvas (prediction off)');

  // ── 1. 3D view (orbit camera) ──
  check('the camera view is a navigable 3D view', (await badge()).includes('3D view'), await badge());
  check('a first-use tip explains the mouse controls', (await page.$eval('.cam-hint', (e) => e.textContent).catch(() => '')).includes('Shift-drag'));
  const fill = await page.evaluate(`(() => { const t = ${snapshotJs}; const x = t.getContext('2d'); const row = (y) => Array.from(x.getImageData(0, y, t.width, 1).data).filter((v, i) => i % 4 === 0 && v === 10).length / t.width; return Math.max(row(2), row(t.height - 3)); })()`);
  check('the 3D view fills the stage', fill < 0.5, String(fill));
  const s0 = state();
  check('starts from the default view', Math.abs(s0.d - 2.8) < 0.01 && Math.abs(s0.el - 0.3) < 0.01 && s0.follow, fmt(s0));
  check('hovering shows a grab cursor', /grab/.test(await page.$eval('.stage__primary .cameraview canvas', (c) => getComputedStyle(c).cursor)));

  await page.mouse.move(cam.x, cam.y);
  for (let i = 0; i < 3; i++) { await page.mouse.wheel({ deltaY: -120 }); await sleep(60); }
  await sleep(700);
  const s1 = state();
  check('scrolling moves the camera in (dolly)', s1.d < s0.d * 0.75, `${s0.d.toFixed(2)} → ${s1.d.toFixed(2)} m`);

  await page.keyboard.down('Shift');
  await page.mouse.move(cam.x, cam.y);
  await page.mouse.down();
  await page.mouse.move(cam.x + 120, cam.y + 20, { steps: 6 });
  const pivot = (await page.$('.orbit-focus')) !== null;
  await page.mouse.move(cam.x + 240, cam.y + 40, { steps: 6 });
  await page.mouse.up();
  await page.keyboard.up('Shift');
  await sleep(800);
  const s2 = state();
  check('Shift-drag orbits around the robot', Math.abs(s2.az - s1.az) > 0.5 && s2.el > s1.el, `${fmt(s1)} → ${fmt(s2)}`);
  check('the orbit pivot is marked while orbiting', pivot && !(await page.$('.orbit-focus')));
  check('orbiting retires the first-use tip', !(await page.$('.cam-hint')));

  await page.mouse.move(cam.x, cam.y);
  await page.mouse.down({ button: 'middle' });
  await page.mouse.move(cam.x - 200, cam.y, { steps: 6 });
  await page.mouse.up({ button: 'middle' });
  await sleep(800);
  const s3 = state();
  check('middle-drag orbits', Math.abs(s3.az - s2.az) > 0.5, `${s2.az.toFixed(2)} → ${s3.az.toFixed(2)}`);

  await page.mouse.move(cam.x, cam.y + 150);
  await page.mouse.down();
  await page.mouse.move(cam.x + 150, cam.y + 220, { steps: 8 });
  await page.mouse.up();
  await sleep(800);
  const s4 = state();
  check('dragging pans across the ground', Math.hypot(s4.ox - s3.ox, s4.oy - s3.oy) > 0.3 && Math.abs(s4.d - s3.d) < 1e-3, `${fmt(s3)} → ${fmt(s4)}`);

  await page.mouse.move(cam.x, cam.y);
  await page.mouse.down({ button: 'right' });
  await page.mouse.move(cam.x, cam.y - 120, { steps: 6 });
  await page.mouse.up({ button: 'right' });
  await sleep(800);
  const s5 = state();
  check('right-drag up zooms in', s5.d < s4.d * 0.7, `${s4.d.toFixed(2)} → ${s5.d.toFixed(2)} m`);

  await page.keyboard.press('e');
  await sleep(900);
  const s6 = state();
  const dAz = Math.atan2(Math.sin(s6.az - s5.az), Math.cos(s6.az - s5.az));
  check('E orbits right by 22.5° (gliding)', Math.abs(dAz - Math.PI / 8) < 0.01, dAz.toFixed(3));
  await page.keyboard.press('-');
  await sleep(900);
  const s7 = state();
  check('− zooms out', Math.abs(s7.d - s6.d * 1.3) < 0.02, `${s6.d.toFixed(2)} → ${s7.d.toFixed(2)}`);
  await page.click('.cam-controls button[aria-label^="Turning with the robot"]');
  await sleep(800);
  const s8 = state();
  check('the compass button switches to a world-fixed view', !s8.follow, fmt(s8));
  await page.click('.cam-controls button[aria-label^="World-fixed"]');
  await sleep(800);
  const s9 = state();
  check('…and back, without the picture jumping', s9.follow && Math.abs(Math.atan2(Math.sin(s9.az - s7.az), Math.cos(s9.az - s7.az))) < 0.05 && Math.hypot(s9.ox - s7.ox, s9.oy - s7.oy) < 0.05, fmt(s9));

  if (webgl) {
    // the picture answers the pointer at once (re-projected frame), not after the ~0.1 s round trip
    await page.evaluate(`window.__answer = () => new Promise((resolve) => {
      const grab = () => { const t = ${snapshotJs}; const s = document.createElement('canvas'); s.width = 160; s.height = Math.round(t.height * 160 / t.width); s.getContext('2d').drawImage(t, 0, 0, s.width, s.height); return s.getContext('2d').getImageData(0, 0, s.width, s.height).data; };
      const ref = grab(); let ev = 0;
      const onMove = (e) => { if (!ev && e.shiftKey) ev = performance.now(); };
      window.addEventListener('pointermove', onMove, true);
      const t0 = performance.now();
      const tick = () => {
        const g = grab(); let s = 0; for (let i = 0; i < g.length; i += 4) s += Math.abs(g[i] - ref[i]) + Math.abs(g[i + 1] - ref[i + 1]);
        if (ev && s / (g.length / 2) > 3) { window.removeEventListener('pointermove', onMove, true); resolve(performance.now() - ev); }
        else if (performance.now() - t0 > 2000) { window.removeEventListener('pointermove', onMove, true); resolve(-1); }
        else requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    })`);
    const answers = [];
    for (let i = 0; i < 5; i++) {
      await page.keyboard.down('Shift');
      await page.mouse.move(cam.x, cam.y);
      await page.mouse.down();
      await sleep(100);
      const p = page.evaluate(() => window.__answer());
      await sleep(50);
      await page.mouse.move(cam.x + (i % 2 ? -90 : 90), cam.y);
      await page.mouse.up();
      await page.keyboard.up('Shift');
      answers.push(await p);
      await sleep(300);
    }
    const med = [...answers].sort((a, b) => a - b)[2];
    check('the picture answers the pointer within two display frames', med > 0 && med < 40, answers.map((a) => a.toFixed(0)).join(' ') + ' ms');
  }

  await page.mouse.click(cam.x, cam.y, { count: 2 });
  await sleep(800);
  const s10 = state();
  check('double-click resets the view', Math.abs(s10.d - 2.8) < 0.01 && Math.abs(s10.az) < 1e-3 && Math.abs(s10.ox) < 1e-3 && s10.follow, fmt(s10));
  await shot('14_3d_view');

  // ── 2. any other camera: digital zoom (test pattern on /e2e_cam/compressed) ──
  const setCamera = async (topic) => {
    await page.click('button[aria-label="Settings"]');
    await page.waitForSelector('#set-camera');
    await page.focus('#set-camera');
    await page.keyboard.down('Control'); await page.keyboard.press('KeyA'); await page.keyboard.up('Control');
    await page.type('#set-camera', topic);
    await page.evaluate(() => [...document.querySelectorAll('.dialog__foot button')].find((b) => b.textContent === 'Save').click());
  };
  await setCamera('/e2e_cam/compressed');
  await page.waitForFunction(() => /640×360/.test(document.querySelector('.cam-badge')?.textContent ?? ''), { timeout: 15000 }).catch(() => {});
  check('another camera is shown whole, as a plain feed', /Live.*640×360/.test(await badge()) && !(await page.$('.cam-controls button[aria-label="Orbit left"]')), await badge());
  await page.mouse.move(cam.x + 100, cam.y + 50);
  await page.mouse.wheel({ deltaY: -400 });
  await sleep(400);
  check('the wheel zooms it digitally', /\d\.\d×/.test(await badge()), await badge());
  await page.mouse.move(cam.x, cam.y);
  await page.mouse.down();
  await page.mouse.move(cam.x + 160, cam.y + 90, { steps: 8 });
  await page.mouse.up();
  await sleep(300);
  check('dragging pans the zoomed picture (zoom kept)', /\d\.\d×/.test(await badge()), await badge());
  await page.keyboard.press('0');
  await sleep(300);
  check('0 resets the zoom', !/\d\.\d×/.test(await badge()), await badge());
  await page.keyboard.press('+');
  await sleep(300);
  check('+ zooms when the camera is the main view', /1\.4×/.test(await badge()), await badge());
  await page.mouse.click(cam.x, cam.y, { count: 2 });
  await sleep(300);
  check('double-click resets', !/\d\.\d×/.test(await badge()), await badge());
  await setCamera('/chase_camera/image_raw/compressed');
  await page.waitForFunction(() => /3D view/.test(document.querySelector('.cam-badge')?.textContent ?? ''), { timeout: 15000 }).catch(() => {});
  check('back on the simulation camera the 3D view returns', (await badge()).includes('3D view'), await badge());

  // ── 3. picture-in-picture and the map ──
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
  const grip = await page.$eval('.pip__grip', (e) => { const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
  await page.mouse.move(grip.x, grip.y);
  await page.mouse.down();
  await page.mouse.move(grip.x + 160, grip.y, { steps: 8 });
  await page.mouse.up();
  await sleep(300);
  const p2 = await pip();
  check('PiP can be resized from its corner', p2.w > p1.w + 100, `${p1.w} → ${p2.w} px wide`);
  await shot('14_pip_moved');
  await page.reload({ waitUntil: 'networkidle2' });
  await page.waitForFunction(() => document.querySelector('.topbar__status')?.textContent.includes('Connected'), { timeout: 20000 });
  await sleep(800);
  const p3 = await pip();
  check('PiP position and size are remembered', Math.abs(p3.x - p2.x) < 3 && Math.abs(p3.w - p2.w) < 3, `(${p3.x},${p3.y}) ${p3.w}px`);
  await page.click('.pip__body');
  await sleep(600);
  check('clicking the PiP swaps the views', (await page.$('.stage__primary .mapview')) !== null);
  const scale0 = await page.$eval('.scalebar__label', (e) => e.textContent);
  const mv = await page.$eval('.stage__primary .mapview canvas', (c) => { const r = c.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
  await page.mouse.move(mv.x, mv.y);
  await page.mouse.wheel({ deltaY: -600 });
  await sleep(400);
  check('map wheel zoom still works', scale0 !== (await page.$eval('.scalebar__label', (e) => e.textContent)));
  await page.evaluate(() => localStorage.removeItem('semantic-nav-hmi:pip'));
  check('no page errors', (await page.evaluate(() => (window.__errors ?? []).length)) === 0);
};
