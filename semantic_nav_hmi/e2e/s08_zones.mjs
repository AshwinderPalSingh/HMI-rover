import { calibrate, robotPose, freeTarget } from './lib.mjs';
const zoneList = (ros) => ros(`timeout 8 ros2 topic echo --once --qos-durability transient_local --qos-reliability reliable /keepout_zone_list semantic_nav_interfaces/msg/KeepoutZoneArray 2>/dev/null | grep -E "reason|zone_id"`);
const probe = (ros, pts) => ros(`python3 ${process.env.E2E_DIR}/costmap_probe.py ${pts.map((p) => `${p.x} ${p.y}`).join(' ')} 2>/dev/null`).trim();

export default async ({ page, sleep, check, shot, log, ros }) => {
  await page.goto('http://localhost:8097/', { waitUntil: 'networkidle2' });
  await page.waitForFunction(() => document.querySelector('.topbar__status')?.textContent.includes('Connected'), { timeout: 20000 });
  await page.keyboard.press('4');
  await sleep(2500);
  const { toScreen } = await calibrate(page);
  const r = await robotPose(page);
  const c = freeTarget(r.x, r.y); // zone centre with clearance, away from the robot
  const half = 1.0;
  const corners = [
    { x: c.x - half, y: c.y - half },
    { x: c.x + half, y: c.y - half },
    { x: c.x + half, y: c.y + half },
    { x: c.x - half, y: c.y + half },
  ];
  log('zone centre', c, 'robot', r);
  const before = probe(ros, [c]);
  await page.keyboard.press('k');
  await sleep(300);
  for (const p of corners) {
    const s = toScreen(p.x, p.y);
    await page.mouse.click(s.x, s.y);
    await sleep(150);
  }
  await shot('08_zone_drawing_1440');
  const first = toScreen(corners[0].x, corners[0].y);
  await page.mouse.move(first.x, first.y);
  await sleep(150);
  await page.mouse.click(first.x, first.y); // close polygon
  await page.waitForSelector('#zone-reason', { timeout: 5000 });
  await page.type('#zone-reason', 'e2e wet floor');
  await shot('08_zone_dialog_1440');
  await page.evaluate(() => [...document.querySelectorAll('.dialog__foot button')].find((b) => /Add keep-out zone/.test(b.textContent)).click());
  await page.waitForFunction(() => document.body.textContent.includes('e2e wet floor') && document.querySelector('.zone-row'), { timeout: 10000 }).catch(() => {});
  check('zone appears in the console list', await page.evaluate(() => [...document.querySelectorAll('.zone-row__name')].some((e) => e.textContent === 'e2e wet floor')));
  const zl = zoneList(ros);
  check('zone is in /keepout_zone_list', zl.includes('e2e wet floor'), zl.replace(/\n/g, ' '));
  await sleep(2500);
  const inside = probe(ros, [c]);
  check('global costmap is lethal inside the zone', inside === '254', `before ${before} → after ${inside}`);
  await shot('08_zone_added_1440');

  // Nav2 costmap clear (what the BT recovery does) must NOT drop the zone
  ros(`timeout 10 ros2 service call /global_costmap/clear_entirely_global_costmap nav2_msgs/srv/ClearEntireCostmap "{}"`);
  await sleep(3000);
  const afterClear = probe(ros, [c]);
  const zl2 = zoneList(ros);
  check('zone survives a Nav2 costmap clear (reset fix)', zl2.includes('e2e wet floor') && afterClear === '254', `cost ${afterClear}`);

  // a goal inside the zone must fail with an explanation
  const s = toScreen(c.x, c.y);
  await page.keyboard.press('g');
  await page.mouse.click(s.x, s.y);
  const failed = await page.waitForFunction(() => /failed/i.test(document.querySelectorAll('.topbar__status .pill')[2]?.textContent ?? ''), { timeout: 60000 }).then(() => true).catch(() => false);
  check('goal inside a keep-out zone is refused and reported', failed);
  await shot('08_goal_in_zone_1440');

  // remove the zone from the list
  await page.evaluate(() => {
    const row = [...document.querySelectorAll('.zone-row')].find((r) => r.textContent.includes('e2e wet floor'));
    row.querySelector('button[aria-label="Remove zone"]').click();
  });
  const rowGone = () => ![...document.querySelectorAll('.zone-row__name')].some((e) => e.textContent === 'e2e wet floor');
  await page.waitForFunction(rowGone, { timeout: 10000 }).catch(() => {});
  check('zone removed from the console list', await page.evaluate(rowGone));
  await sleep(3000);
  const freed = probe(ros, [c]);
  check('costmap cells freed after removal (re-cost fix)', Number(freed) < 253, `cost ${freed}`);
  check('/keepout_zone_list is empty', !zoneList(ros).includes('e2e wet floor'));
};
