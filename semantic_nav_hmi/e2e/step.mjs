// Usage: node step.mjs <stepfile.mjs>   — runs against the persistent browser
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import { execSync } from 'node:child_process';
import path from 'node:path';
const SP = process.env.E2E_DIR;
const browser = await puppeteer.connect({ browserWSEndpoint: fs.readFileSync(`${SP}/ws.txt`, 'utf8').trim(), defaultViewport: null });
let [page, ...extra] = await browser.pages();
if (!page) page = await browser.newPage();
// a previous step may have left pages behind (e.g. a crashed second console): close them
for (const p of extra) { try { await p.close({ runBeforeUnload: false }); } catch {} }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log('·', ...a);
const shot = async (name) => { const p = `${SP}/shots/${name}.png`; await page.screenshot({ path: p }); log('screenshot', p); };
const ros = (cmd, timeout = 20000) => {
  const full = `export HOME=${SP}/home ROS_DOMAIN_ID=${process.env.ROS_DOMAIN_ID_E2E}; source /opt/ros/humble/setup.bash; source ${process.env.WS}/install/setup.bash; ${cmd}`;
  try { return execSync(full, { shell: '/bin/bash', timeout, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }); }
  catch (e) { return `ERR ${e.status}: ${(e.stdout || '') + (e.stderr || '')}`; }
};
const text = (sel) => page.$eval(sel, (el) => el.textContent.trim()).catch(() => null);
const texts = (sel) => page.$$eval(sel, (els) => els.map((e) => e.textContent.trim()));
const errors = () => page.evaluate(() => window.__errors ?? []);
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); };
const mod = await import(path.resolve(process.argv[2]));
try {
  await mod.default({ page, browser, sleep, log, shot, ros, text, texts, errors, check, SP });
} catch (e) {
  console.log('STEP THREW', e?.stack || e);
  results.push({ name: 'step threw', ok: false });
}
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
browser.disconnect();
process.exit(failed ? 1 : 0);
