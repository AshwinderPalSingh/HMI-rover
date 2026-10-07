import { calibrate, robotPose, navChip, speedOf, speedMedian, freeTarget } from './lib.mjs';
export default async ({ page, sleep, check, shot, log, ros }) => {
  await page.goto('http://localhost:8097/', { waitUntil: 'networkidle2' });
  await page.waitForFunction(() => document.querySelector('.topbar__status')?.textContent.includes('Connected'), { timeout: 20000 });
  await page.keyboard.press('4'); // Command mode: goal tool
  await sleep(2500);
  const { toScreen, ppm } = await calibrate(page);
  log('calibrated ppm', ppm.toFixed(2));
  const start = await robotPose(page);
  const target = freeTarget(start.x, start.y);
  log('target with clearance:', target);
  const s = toScreen(target.x, target.y);
  // click-drag: press at target, drag east to set heading 0
  await page.mouse.move(s.x, s.y);
  await page.mouse.down();
  await page.mouse.move(s.x + 40, s.y, { steps: 5 });
  await page.mouse.up();
  await sleep(1500);
  const chip1 = await navChip(page);
  check('goal accepted (nav chip shows navigating)', /Navigating|Sending/.test(chip1), chip1);
  const card = await page.$eval('.nav-card', (e) => e.textContent).catch(() => '');
  check('nav card shows target and stats', /Remaining/.test(card) && /ETA/.test(card), card.slice(0, 90));
  check('goal is attributed to this console (not "another client")', !/another client/.test(card) && /\(-?[\d.]+, -?[\d.]+\)/.test(card), card.slice(0, 60));
  await sleep(4000);
  await shot('07_navigating_1440');
  const planCount = await page.evaluate(() => 0);
  const ok = await page.waitForFunction(() => /Arrived/.test(document.querySelectorAll('.topbar__status .pill')[2]?.textContent ?? ''), { timeout: 90000, polling: 500 }).then(() => true).catch(() => false);
  const end = await robotPose(page);
  const err = Math.hypot(end.x - target.x, end.y - target.y);
  check('robot arrives at the clicked goal', ok && err < 0.6, `final (${end.x}, ${end.y}) vs target (${target.x.toFixed(2)}, ${target.y.toFixed(2)}) → ${err.toFixed(2)} m`);
  await shot('07_arrived_1440');

  // cancel via nav card
  const s2 = toScreen(start.x, start.y);
  await page.mouse.click(s2.x, s2.y);
  await page.waitForFunction(() => /Navigating/.test(document.querySelectorAll('.topbar__status .pill')[2]?.textContent ?? ''), { timeout: 15000 }).catch(() => {});
  await sleep(2500);
  await page.evaluate(() => [...document.querySelectorAll('.nav-card button')].find((b) => /Cancel navigation/.test(b.textContent))?.click());
  await page.waitForFunction(() => /Canceled/.test(document.querySelectorAll('.topbar__status .pill')[2]?.textContent ?? ''), { timeout: 15000 }).catch(() => {});
  const chip2 = await navChip(page);
  check('Cancel navigation stops Nav2', /Canceled/.test(chip2), chip2);
  await sleep(2500); // the sim base brakes at 0.14 m/s² (max_wheel_acceleration 1.0)
  const vc = speedMedian(ros);
  check('robot is stationary after cancel (EKF noise < 0.05)', vc < 0.05, vc.toFixed(3));

  // STOP (Space) while navigating
  await page.mouse.click(s.x, s.y);
  await page.waitForFunction(() => /Navigating/.test(document.querySelectorAll('.topbar__status .pill')[2]?.textContent ?? ''), { timeout: 15000 }).catch(() => {});
  await sleep(3000);
  const vMoving = speedOf(ros);
  await page.keyboard.press('Space');
  await sleep(2000);
  const vAfter = speedMedian(ros);
  const chip3 = await navChip(page);
  check('STOP (Space) cancels navigation and halts the robot', Math.abs(vMoving) > 0.05 && vAfter < 0.05 && /Canceled|Idle/.test(chip3), `moving ${vMoving.toFixed(2)} → ${vAfter.toFixed(3)} m/s, chip "${chip3}"`);
  await shot('07_stopped_1440');
};
