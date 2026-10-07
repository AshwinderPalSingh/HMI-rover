const chat = (page) => page.$$eval('.conversation__list .msg', (els) => els.map((e) => (e.classList.contains('msg--user') ? '> ' : '< ') + e.textContent.trim()));
const send = async (page, text) => {
  await page.focus('.composer__input');
  await page.type('.composer__input', text);
  await page.keyboard.press('Enter');
};
export default async ({ page, sleep, check, shot, log, ros }) => {
  await page.goto('http://localhost:8097/', { waitUntil: 'networkidle2' });
  await page.waitForFunction(() => document.querySelector('.topbar__status')?.textContent.includes('Connected'), { timeout: 20000 });
  await page.keyboard.press('4');
  await sleep(2000);

  // 1. plain navigation command (article must be tolerated)
  await send(page, 'go to the ash house');
  await page.waitForFunction(() => /Navigat/.test(document.querySelector('.conversation__list')?.textContent ?? ''), { timeout: 15000 }).catch(() => {});
  await page.waitForFunction(() => /Navigating/.test(document.querySelectorAll('.topbar__status .pill')[2]?.textContent ?? ''), { timeout: 15000 }).catch(() => {});
  const c1 = await chat(page);
  log('chat:', c1.join(' | '));
  check('command reaches the pipeline and Nav2 starts', /Navigating/.test(await page.$eval('.topbar__status', (e) => e.textContent)), c1.slice(-2).join(' | '));
  const card = await page.$eval('.nav-card', (e) => e.textContent).catch(() => '');
  check('external (voice) goal shown in nav card', /another client/.test(card), card.slice(0, 60));
  await sleep(2500);
  await shot('09_voice_nav_1440');
  await send(page, 'cancel');
  await page.waitForFunction(() => /Canceled/.test(document.querySelectorAll('.topbar__status .pill')[2]?.textContent ?? ''), { timeout: 20000 }).catch(() => {});
  check('"cancel" by text cancels the voice goal', /Canceled/.test(await page.$eval('.topbar__status', (e) => e.textContent)));

  // 2. ambiguity → question with options → answer by click
  await send(page, 'go to h');
  await page.waitForSelector('.msg--question .chip', { timeout: 15000 }).catch(() => {});
  const opts = await page.$$eval('.msg--question .chip', (els) => els.map((e) => e.textContent));
  log('question options:', opts.join(', '));
  check('ambiguous target asks a question with options', opts.length >= 2, opts.join(', '));
  await shot('09_question_1440');
  if (opts.includes('h2')) {
    await page.evaluate(() => [...document.querySelectorAll('.msg--question .chip')].find((b) => b.textContent === 'h2').click());
    await page.waitForFunction(() => /Navigating/.test(document.querySelectorAll('.topbar__status .pill')[2]?.textContent ?? ''), { timeout: 15000 }).catch(() => {});
    check('answering the question starts navigation', /Navigating/.test(await page.$eval('.topbar__status', (e) => e.textContent)));
    await sleep(2000);
    await page.keyboard.press('Space'); // STOP
    await page.waitForFunction(() => /Canceled/.test(document.querySelectorAll('.topbar__status .pill')[2]?.textContent ?? ''), { timeout: 10000 }).catch(() => {});
    const chip = await page.$$eval('.topbar__status .pill', (els) => els[2]?.textContent ?? '');
    check('STOP cancels the voice-initiated goal', /Canceled/.test(chip), chip);
    await sleep(1000);
  }

  // 3. category avoid
  await send(page, 'avoid all houses');
  await sleep(6000);
  const c3 = await chat(page);
  log('after "avoid all houses":', c3.slice(-3).join(' | '));
  const zones = await page.$$eval('.zone-row__name', (els) => els.map((e) => e.textContent));
  check('"avoid all houses" creates keep-out zones for every house', zones.length >= 5, `zones: ${zones.join(', ') || 'none'}`);
  await shot('09_avoid_all_1440');

  // 4. clear the whole category by voice
  await send(page, "it's okay to go near all houses");
  await page.waitForFunction(() => document.querySelectorAll('.zone-row').length === 0, { timeout: 15000 }).catch(() => {});
  const left = await page.$$eval('.zone-row__name', (els) => els.length);
  const c4 = await chat(page);
  log('after clear:', c4.slice(-2).join(' | '));
  check('"it\'s okay to go near all houses" clears the zone group', left === 0, `${left} zones left`);
};
