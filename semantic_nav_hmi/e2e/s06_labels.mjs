const getLabels = (ros) => ros(`timeout 12 ros2 service call /get_labels semantic_nav_interfaces/srv/GetLabels "{}" 2>/dev/null | tr ',' '\\n' | grep -o "display_name='[^']*'"`);
const rowNames = (page) => page.$$eval('.label-row__name', (els) => els.map((e) => e.textContent));
const typeInto = async (page, sel, value) => {
  await page.focus(sel);
  await page.keyboard.down('Control');
  await page.keyboard.press('KeyA');
  await page.keyboard.up('Control');
  await page.keyboard.press('Backspace');
  await page.type(sel, value);
};

export default async ({ page, sleep, check, shot, log, ros }) => {
  // remove leftovers from earlier runs
  const ids = ros(`timeout 12 ros2 service call /get_labels semantic_nav_interfaces/srv/GetLabels "{}" 2>/dev/null | tr ',' '\\n' | grep -o "label_id='[^']*'\\|display_name='[^']*'" | paste - - | grep E2E | grep -o "label_id='[^']*'" | cut -d"'" -f2`).trim().split(/\s+/).filter((x) => /^[0-9a-f-]{36}$/.test(x));
  for (const id of ids) ros(`timeout 12 ros2 service call /remove_label semantic_nav_interfaces/srv/RemoveLabel "{label_id: '${id}'}"`);
  log('cleaned leftovers:', ids.length);
  await page.goto('http://localhost:8097/', { waitUntil: 'networkidle2' });
  await page.waitForFunction(() => document.querySelector('.topbar__status')?.textContent.includes('Connected'), { timeout: 20000 });
  await page.keyboard.press('3');
  await page.waitForFunction(() => document.querySelectorAll('.label-row').length >= 5, { timeout: 15000 });
  check('labels load from /label_list', true, (await rowNames(page)).join(', '));
  await sleep(1500);

  // create: label tool is the default in Label mode — click the map
  const box = await page.$eval('.stage__primary canvas', (c) => { const r = c.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
  await page.mouse.click(box.x + box.w * 0.55, box.y + box.h * 0.72);
  await page.waitForSelector('#label-name', { timeout: 5000 });
  const xy = await page.evaluate(() => [document.querySelector('#label-x').value, document.querySelector('#label-y').value]);
  log('dialog prefilled at', xy.join(', '));
  await page.type('#label-name', 'E2E Dock');
  await page.type('#label-aliases', 'dock, charger');
  await page.evaluate(() => [...document.querySelectorAll('.type-chip')].find((b) => b.textContent.includes('Landmark')).click());
  await typeInto(page, '#label-radius', '2');
  await shot('06_label_dialog_1440');
  await page.evaluate(() => [...document.querySelectorAll('.dialog__foot button')].find((b) => b.textContent.includes('Create label')).click());
  await page.waitForFunction(() => [...document.querySelectorAll('.label-row__name')].some((e) => e.textContent === 'E2E Dock'), { timeout: 10000 }).catch(() => {});
  check('created label appears in the list (via /label_list snapshot)', (await rowNames(page)).includes('E2E Dock'));
  check('created label is in the database (/get_labels)', getLabels(ros).includes("display_name='E2E Dock'"));

  // duplicate name is refused
  await page.mouse.click(box.x + box.w * 0.35, box.y + box.h * 0.3);
  await page.waitForSelector('#label-name', { timeout: 5000 });
  await page.type('#label-name', 'h1');
  await page.evaluate(() => [...document.querySelectorAll('.dialog__foot button')].find((b) => b.textContent.includes('Create label')).click());
  await sleep(400);
  const err = await page.$eval('.field__error', (e) => e.textContent).catch(() => null);
  check('duplicate label name is rejected with a reason', !!err && /already has this name/.test(err), err ?? 'no error shown');
  await page.keyboard.press('Escape');
  await sleep(300);

  // edit via the row's pencil button
  await page.evaluate(() => {
    const row = [...document.querySelectorAll('.label-row')].find((r) => r.querySelector('.label-row__name')?.textContent === 'E2E Dock');
    row.querySelector('button[aria-label="Edit"]').click();
  });
  await page.waitForSelector('#label-name', { timeout: 5000 });
  await typeInto(page, '#label-name', 'E2E Charger');
  await page.evaluate(() => [...document.querySelectorAll('.dialog__foot button')].find((b) => b.textContent.includes('Save changes')).click());
  await page.waitForFunction(() => [...document.querySelectorAll('.label-row__name')].some((e) => e.textContent === 'E2E Charger'), { timeout: 10000 }).catch(() => {});
  const names = await rowNames(page);
  check('edit renames the label (/update_label)', names.includes('E2E Charger') && !names.includes('E2E Dock'), names.join(', '));
  await shot('06_label_list_1440');

  // delete with confirmation
  await page.evaluate(() => {
    const row = [...document.querySelectorAll('.label-row')].find((r) => r.querySelector('.label-row__name')?.textContent === 'E2E Charger');
    row.querySelector('button[aria-label="Delete"]').click();
  });
  await page.waitForSelector('.dialog__foot .btn--danger', { timeout: 5000 });
  await shot('06_confirm_1440');
  await page.click('.dialog__foot .btn--danger');
  await page.waitForFunction(() => ![...document.querySelectorAll('.label-row__name')].some((e) => e.textContent === 'E2E Charger'), { timeout: 10000 }).catch(() => {});
  check('delete removes it from the list', !(await rowNames(page)).includes('E2E Charger'));
  check('delete removes it from the database', !getLabels(ros).includes('E2E'));
};
