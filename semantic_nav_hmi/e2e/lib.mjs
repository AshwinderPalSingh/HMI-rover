// screen <-> world calibration through the console's own coordinate readout
export async function calibrate(page) {
  const box = await page.$eval('.stage__primary canvas', (c) => { const r = c.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
  const read = async (sx, sy) => {
    await page.mouse.move(sx, sy);
    await new Promise((r) => setTimeout(r, 120));
    const t = await page.$eval('.map-readout__coords', (e) => e.textContent);
    const m = t.match(/x\s*(-?[\d.]+)\s+y\s*(-?[\d.]+)/);
    return { x: Number(m[1]), y: Number(m[2]) };
  };
  const a = await read(box.x + box.w * 0.3, box.y + box.h * 0.3);
  const b = await read(box.x + box.w * 0.7, box.y + box.h * 0.7);
  const ppm = (box.w * 0.4) / (b.x - a.x);
  const toScreen = (wx, wy) => ({ x: box.x + box.w * 0.3 + (wx - a.x) * ppm, y: box.y + box.h * 0.3 - (wy - a.y) * ppm });
  return { box, ppm, toScreen };
}
export async function robotPose(page) {
  const t = await page.$eval('.robot-card .tile', (el) => el.textContent);
  const m = t.match(/x\s*(-?[\d.]+)\s*y\s*(-?[\d.]+)/);
  return m ? { x: Number(m[1]), y: Number(m[2]) } : null;
}
export const navChip = (page) => page.$$eval('.topbar__status .pill', (els) => els[2]?.textContent ?? '');
export const speedOf = (ros) => {
  const out = ros(`timeout 6 ros2 topic echo --once /odometry/filtered nav_msgs/msg/Odometry 2>/dev/null | grep -A3 "twist:" | grep -A1 "linear:" | grep "x:"`);
  const m = out.match(/x:\s*(-?[\d.e-]+)/);
  return m ? Number(m[1]) : NaN;
};
export const speedMedian = (ros, n = 3) => {
  const xs = [];
  for (let i = 0; i < n; i++) xs.push(Math.abs(speedOf(ros)));
  xs.sort((a, b) => a - b);
  return xs[Math.floor(n / 2)];
};
import { execSync } from 'node:child_process';
export const freeTarget = (x, y) => {
  const out = execSync(`python3 ${process.env.E2E_DIR}/free_target.py ${x} ${y} 2>/dev/null`, { encoding: 'utf8' }).trim();
  const [tx, ty] = out.split(/\s+/).map(Number);
  return { x: tx, y: ty };
};
export const twistOf = (ros) => {
  const out = ros(`timeout 6 ros2 topic echo --once /odometry/filtered nav_msgs/msg/Odometry 2>/dev/null | sed -n '/^twist:/,$p'`);
  const lin = out.match(/linear:\s*\n\s*x:\s*(-?[\d.e-]+)/);
  const ang = out.match(/angular:\s*\n\s*x:\s*-?[\d.e-]+\s*\n\s*y:\s*-?[\d.e-]+\s*\n\s*z:\s*(-?[\d.e-]+)/);
  return { v: lin ? Number(lin[1]) : NaN, w: ang ? Number(ang[1]) : NaN };
};
/** Collect every /cmd_vel message for `secs` seconds; returns [[vx, wz], ...] */
export const cmdWindow = (ros, secs) => {
  const out = ros(`timeout ${secs} ros2 topic echo /cmd_vel geometry_msgs/msg/Twist 2>/dev/null`, (secs + 5) * 1000);
  const msgs = out.split('---').map((b) => {
    const lx = b.match(/linear:\s*\n\s*x:\s*(-?[\d.e-]+)/);
    const az = b.match(/angular:\s*\n\s*x:\s*-?[\d.e-]+\s*\n\s*y:\s*-?[\d.e-]+\s*\n\s*z:\s*(-?[\d.e-]+)/);
    return lx && az ? [Number(lx[1]), Number(az[1])] : null;
  });
  return msgs.filter(Boolean);
};
export const commanded = (page) => page.$$eval('.velbar__head', (els) => els.map((e) => Number((e.textContent.match(/Commanded\s*(-?[\d.]+)/) || [, 'NaN'])[1])));
