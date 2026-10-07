import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
const SP = process.env.E2E_DIR;
const browser = await puppeteer.launch({
  executablePath: process.env.CHROME,
  headless: true,
  // a real GPU through Vulkan where there is one, so WebGL runs as in the operator's browser
  // (without one the console falls back to a 2D canvas and the prediction checks are skipped)
  args: ['--no-sandbox', '--window-size=1440,900', '--force-device-scale-factor=1', '--hide-scrollbars',
    '--use-angle=vulkan', '--enable-features=Vulkan', '--enable-gpu', '--ignore-gpu-blocklist'],
  defaultViewport: { width: 1440, height: 900 },
});
fs.writeFileSync(`${SP}/ws.txt`, browser.wsEndpoint());
console.log('browser up', browser.wsEndpoint());
const bye = async () => { try { await browser.close(); } catch {} process.exit(0); };
process.on('SIGTERM', bye);
process.on('SIGINT', bye);
setInterval(() => {}, 1 << 30);
