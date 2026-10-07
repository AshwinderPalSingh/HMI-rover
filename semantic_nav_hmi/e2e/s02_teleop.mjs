import { twistOf, cmdWindow, commanded } from './lib.mjs';
const lastCmd = (ros) => {
  const out = ros(`timeout 4 ros2 topic echo --once /cmd_vel geometry_msgs/msg/Twist 2>/dev/null | head -4`);
  const m = out.match(/x:\s*(-?[\d.e-]+)/);
  return m ? Number(m[1]) : null;
};
const pose = async (page) => {
  const t = await page.$eval('.robot-card .tile', (el) => el.textContent);
  const m = t.match(/x\s*(-?[\d.]+)\s*y\s*(-?[\d.]+)/);
  return m ? { x: Number(m[1]), y: Number(m[2]) } : null;
};
const connected = (p) => p.waitForFunction(() => document.querySelector('.topbar__status')?.textContent.includes('Connected'), { timeout: 20000 });

export default async ({ page, sleep, check, ros, shot, log, browser }) => {
  await page.goto('http://localhost:8097/', { waitUntil: 'networkidle2' });
  await connected(page);
  await page.keyboard.press('1');
  await sleep(3500);
  const lat = await page.$eval('.topbar__status .pill', (e) => e.textContent);
  const ms = Number((lat.match(/(\d+) ms/) || [, '999'])[1]);
  check('latency is a real round trip (<100 ms on localhost)', ms < 100, lat);

  // 1. forward with W, release
  const p0 = await pose(page);
  await page.keyboard.down('w');
  await sleep(1500);
  const fwd = twistOf(ros);
  const cmd = lastCmd(ros);
  check('W drives forward', fwd.v > 0.1, `v ${fwd.v.toFixed(3)}`);
  check('/cmd_vel carries the command through the guard', cmd !== null && cmd > 0.1, String(cmd));
  await shot('02_driving_1440');
  await page.keyboard.up('w');
  await sleep(2200); // base brakes at 0.14 m/s²
  const st1 = twistOf(ros);
  check('release stops the robot', Math.abs(st1.v) < 0.05, `v ${st1.v.toFixed(3)}`);
  const p1 = await pose(page);
  const moved = p0 && p1 ? Math.hypot(p1.x - p0.x, p1.y - p0.y) : 0;
  check('pose updates in the console', moved > 0.15, `${moved.toFixed(2)} m`);

  // 2. reverse back with S
  await page.keyboard.down('s');
  await sleep(1500);
  const rev = twistOf(ros);
  check('S reverses', rev.v < -0.1, `v ${rev.v.toFixed(3)}`);
  await page.keyboard.up('s');
  await sleep(2200);

  // 3. focus loss mid-turn: the console must drop the command and go silent
  await page.keyboard.down('a');
  await sleep(1000);
  const [, wHeld] = await commanded(page);
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await sleep(600);
  const [, wAfter] = await commanded(page);
  const tail = cmdWindow(ros, 2);
  check('window blur releases a held key (console command → 0)', wHeld > 0.3 && wAfter === 0, `commanded ω ${wHeld} → ${wAfter}`);
  check('…and /cmd_vel carries no non-zero command afterwards', tail.every(([v, w]) => v === 0 && w === 0), `${tail.length} msgs`);
  await page.keyboard.up('a');
  await sleep(1500);

  // 4. joystick: push right = turn right (negative yaw rate)
  const box = await page.$eval('.joystick', (el) => { const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
  await page.mouse.move(box.x, box.y);
  await page.mouse.down();
  await page.mouse.move(box.x + 75, box.y, { steps: 6 });
  await sleep(700);
  const [, wJoy] = await commanded(page);
  const live = cmdWindow(ros, 2);
  check('joystick right commands a right turn', wJoy < -0.3 && live.some(([, w]) => w < -0.3), `commanded ω ${wJoy}, /cmd_vel min ω ${Math.min(...live.map((m) => m[1]))}`);
  await page.mouse.up();
  await sleep(600);
  const [, wRel] = await commanded(page);
  check('joystick release returns the command to 0', wRel === 0, `ω ${wRel}`);
  await sleep(1500);

  // 5. deadman: a second console crashes mid-drive; only the guard can stop the base
  const lostBefore = Number(ros(`grep -c "Teleop stream lost" ${process.env.E2E_DIR}/launch.log || true`).trim() || 0);
  const page2 = await browser.newPage();
  await page2.goto('http://localhost:8097/', { waitUntil: 'networkidle2' });
  await connected(page2);
  await sleep(1500);
  await page2.bringToFront();
  await page2.keyboard.press('1');
  await page2.keyboard.down('a');
  await sleep(1200);
  const during = cmdWindow(ros, 2);
  const cdp = await page2.target().createCDPSession();
  await Promise.race([cdp.send('Page.crash').catch(() => {}), sleep(3000)]);
  await sleep(1200);
  const afterCrash = cmdWindow(ros, 2);
  const lostAfter = Number(ros(`grep -c "Teleop stream lost" ${process.env.E2E_DIR}/launch.log || true`).trim() || 0);
  check('crash mid-drive: guard publishes a stop and the stream ends', during.some(([, w]) => w > 0.3) && lostAfter === lostBefore + 1 && afterCrash.every(([v, w]) => v === 0 && w === 0),
    `during max ω ${Math.max(...during.map((m) => m[1]))}, guard stops ${lostBefore}→${lostAfter}, after: ${afterCrash.length} msgs`);
  try { await Promise.race([page2.close({ runBeforeUnload: false }), sleep(3000)]); } catch {}
  await page.bringToFront();
};
