export default async ({ page, sleep, check, shot, log }) => {
  const sizes = [
    { name: '1024', w: 1024, h: 768, modes: ['1', '2', '3', '4'] },
    { name: 'phone', w: 390, h: 844, modes: ['1', '4'] },
    { name: '1920', w: 1920, h: 1080, modes: ['4'] },
  ];
  for (const sz of sizes) {
    await page.setViewport({ width: sz.w, height: sz.h, deviceScaleFactor: 1 });
    await page.goto('http://localhost:8097/', { waitUntil: 'networkidle2' });
    await page.waitForFunction(() => document.querySelector('.topbar__status')?.textContent.includes('Connected'), { timeout: 20000 });
    await sleep(2500);
    for (const m of sz.modes) {
      await page.keyboard.press(m);
      await sleep(1200);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      check(`no horizontal overflow at ${sz.w}px (mode ${m})`, overflow <= 0, `${overflow}px`);
      await shot(`11_${sz.name}_mode${m}`);
    }
  }
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
};
