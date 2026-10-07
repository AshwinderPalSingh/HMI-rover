import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
const SP = process.env.E2E_DIR;
const browser = await puppeteer.launch({
  executablePath: process.env.CHROME,
  headless: true,
  args: ['--no-sandbox', '--window-size=1440,900', '--force-device-scale-factor=1', '--hide-scrollbars'],
  defaultViewport: { width: 1440, height: 900 },
});
fs.writeFileSync(`${SP}/ws.txt`, browser.wsEndpoint());
console.log('browser up', browser.wsEndpoint());
const bye = async () => { try { await browser.close(); } catch {} process.exit(0); };
process.on('SIGTERM', bye);
process.on('SIGINT', bye);
setInterval(() => {}, 1 << 30);
