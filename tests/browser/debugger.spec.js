import { test, expect } from '@playwright/test';
async function activate(page) {
  await page.keyboard.down('Control'); await page.keyboard.press('3'); await page.keyboard.press('0'); await page.keyboard.press('5'); await page.keyboard.up('Control');
  await expect(page.getByRole('button', { name: 'Open web debugger' })).toBeVisible();
  await page.getByRole('button', { name: 'Open web debugger' }).click();
}
test.beforeEach(async ({ page }) => { await page.goto('/'); await page.waitForFunction(() => !!window.debuggerController); });

test('shortcut, round button, fetch inspection, response search, console and cleanup', async ({ page }) => {
  await expect(page.getByRole('button', { name: 'Open web debugger' })).toHaveCount(0);
  await activate(page);
  const result = await page.evaluate(async () => {
    const promise = fetch('/api/example?q=hello&token=private-value', { method: 'POST', headers: { Authorization: 'Bearer private-value' }, body: JSON.stringify({ name: "O'Brien", password: 'private-value' }) });
    const response = await promise; const data = await response.json();
    console.warn({ event: 'order loaded', password: 'private-value' }); return data;
  });
  expect(result.token).toBe('private-value');
  await page.locator('.row').first().click();
  await expect(page.locator('.details')).toContainText('Alice');
  await expect(page.locator('.details')).not.toContainText('private-value');
  await expect(page.locator('.details img')).toHaveCount(0);
  await page.getByRole('textbox', { name: 'Search response', exact: true }).fill('alice');
  await expect(page.locator('.match')).toContainText('$["data"]["orders"][0]["customer"]');
  await expect(page.locator('mark')).toHaveText('Alice');
  await page.getByRole('tab', { name: 'Console' }).click();
  await expect(page.locator('.console')).toContainText('order loaded');
  await expect(page.locator('.console')).not.toContainText('private-value');
  await page.getByRole('tab', { name: 'Network' }).click();
  await page.screenshot({ path: 'test-results/debugger-desktop.png' });
  await page.getByRole('button', { name: 'Minimize debugger' }).click();
  await expect(page.getByRole('button', { name: 'Open web debugger' })).toBeVisible();
  await page.getByRole('button', { name: 'Open web debugger' }).click();
  await page.getByRole('button', { name: 'Stop', exact: true }).click();
  expect(await page.evaluate(() => window.fetch === window.originalFetch && console.log === window.originalLog)).toBe(true);
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('XHR, filtering, pause, clear and mobile layout', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await activate(page);
  const result = await page.evaluate(() => new Promise(resolve => { const xhr = new XMLHttpRequest(); xhr.open('GET', '/api/example'); xhr.onload = () => resolve(JSON.parse(xhr.responseText)); xhr.send(); }));
  expect(result.token).toBe('private-value');
  await expect(page.locator('.row')).toContainText('XHR');
  await page.getByRole('textbox', { name: 'Search requests or console' }).fill('missing-api');
  await expect(page.locator('.row')).toHaveCount(0);
  await page.getByRole('textbox', { name: 'Search requests or console' }).fill('');
  await page.locator('.row').click();
  await expect(page.locator('.details')).toContainText('Alice');
  const bounds = await page.getByRole('dialog').boundingBox();
  expect(bounds.x).toBeGreaterThanOrEqual(0); expect(bounds.x + bounds.width).toBeLessThanOrEqual(390);
  await page.screenshot({ path: 'test-results/debugger-mobile.png' });
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await page.evaluate(() => fetch('/api/example'));
  await expect(page.locator('.row')).toHaveCount(1);
  await page.getByRole('button', { name: 'Clear', exact: true }).click();
  await expect(page.locator('.row')).toHaveCount(0);
});

test('production fails closed and incomplete shortcut does not activate', async ({ page }) => {
  await page.evaluate(() => { window.debuggerController.destroy(); window.debuggerController = window.initDebugger(); });
  expect(await page.evaluate(() => window.debuggerController.enable())).toBe(false);
  await page.evaluate(() => { window.debuggerController.destroy(); window.debuggerController = window.initDebugger({ authorize: () => false }); });
  expect(await page.evaluate(() => window.debuggerController.enable())).toBe(false);
  await page.evaluate(() => { window.debuggerController.destroy(); window.debuggerController = window.initDebugger({ authorize: () => true }); });
  await page.keyboard.down('Control'); await page.keyboard.press('3'); await page.keyboard.up('Control');
  await page.keyboard.down('Control'); await page.keyboard.press('0'); await page.keyboard.press('5'); await page.keyboard.up('Control');
  await expect(page.getByRole('button', { name: 'Open web debugger' })).toHaveCount(0);
  await activate(page);
});

test('authenticated server requests and console appear alongside browser entries', async ({ page }) => {
  await page.evaluate(() => { window.debuggerController.destroy(); window.debuggerController = window.initDebugger({ mode: 'server', serverEndpoint: '/api/web-debugger' }); });
  await activate(page);
  const result = await page.evaluate(async () => (await fetch('/api/server-orders')).json());
  expect(result.token).toBe('private-value');
  await expect(page.locator('.row')).toHaveCount(2);
  const serverRow = page.locator('.row').filter({ hasText: 'Server · fetch' });
  await serverRow.click();
  await expect(page.locator('.details')).toContainText('Alice');
  await expect(page.locator('.details')).not.toContainText('private-value');
  await page.getByRole('tab', { name: 'Console' }).click();
  await expect(page.locator('.console')).toContainText('server order loaded');
  await page.getByRole('button', { name: 'Clear', exact: true }).click();
  await page.waitForTimeout(1700);
  await expect(page.locator('.log')).toHaveCount(0);
  await page.getByRole('button', { name: 'Stop', exact: true }).click();
  await expect.poll(() => page.evaluate(async () => (await fetch('/api/web-debugger')).status)).toBe(404);
});

test('round button and panel drag independently, stay on screen and preserve clicks', async ({ page }) => {
  await page.evaluate(() => window.debuggerController.enable());
  const bubble = page.getByRole('button', { name: 'Open web debugger' });
  const before = await bubble.boundingBox();
  await page.mouse.move(before.x + 27, before.y + 27); await page.mouse.down();
  await page.mouse.move(120, 120, { steps: 8 }); await page.mouse.up();
  await expect(page.getByRole('dialog')).toBeHidden();
  const moved = await bubble.boundingBox();
  expect(moved.x).toBeLessThan(before.x); expect(moved.y).toBeLessThan(before.y);
  await bubble.click();
  const panel = page.getByRole('dialog'), header = page.locator('.head strong');
  const start = await panel.boundingBox(), heading = await header.boundingBox();
  await page.mouse.move(heading.x + 10, heading.y + 8); await page.mouse.down();
  await page.mouse.move(heading.x - 100, heading.y + 18, { steps: 8 }); await page.mouse.up();
  expect((await panel.boundingBox()).x).toBeLessThan(start.x);
  await page.getByRole('button', { name: 'Minimize debugger' }).click();
  expect((await bubble.boundingBox()).x).toBeCloseTo(moved.x, 0);
  await page.setViewportSize({ width: 390, height: 400 });
  await bubble.click();
  const resized = await panel.boundingBox();
  expect(resized.x).toBeGreaterThanOrEqual(0); expect(resized.y).toBeGreaterThanOrEqual(0);
  expect(resized.x + resized.width).toBeLessThanOrEqual(390);
  expect(resized.y + resized.height).toBeLessThanOrEqual(400);
});

test('labels RSC navigation and filters it without changing JSON response capture', async ({ page }) => {
  await activate(page);
  const payload = await page.evaluate(async () => (await fetch('/news/example?_rsc=sample', { headers: { rsc: '1' } })).text());
  expect(payload).toContain('$Sreact.fragment');
  await page.evaluate(() => fetch('/api/example'));
  await expect(page.locator('.row')).toHaveCount(2);
  await page.locator('.row').filter({ hasText: 'Next.js navigation' }).click();
  await expect(page.locator('.rsc-note')).toContainText('Backend API JSON fetched during SSR requires server capture');
  await expect(page.locator('.details')).toContainText('$Sreact.fragment');
  await page.getByRole('button', { name: 'Hide Next.js navigation' }).click();
  await expect(page.locator('.row')).toHaveCount(1);
  await page.locator('.row').click();
  await expect(page.locator('.details')).toContainText('Alice');
  await expect(page.locator('.rsc-note')).toHaveCount(0);
  await page.getByRole('button', { name: 'Show Next.js navigation' }).click();
  await expect(page.locator('.row')).toHaveCount(2);
});

test.describe('touch dragging', () => {
  test.use({ hasTouch: true });
  test('moves the round button with a touch gesture without opening the panel', async ({ page, context }) => {
    await page.evaluate(() => window.debuggerController.enable());
    const bubble = page.getByRole('button', { name: 'Open web debugger' });
    const bounds = await bubble.boundingBox();
    const session = await context.newCDPSession(page);
    await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: bounds.x + 27, y: bounds.y + 27 }] });
    await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 80, y: 80 }] });
    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expect(page.getByRole('dialog')).toBeHidden();
    const moved = await bubble.boundingBox();
    expect(moved.x).toBeLessThan(bounds.x); expect(moved.y).toBeLessThan(bounds.y);
    await bubble.tap();
    await expect(page.getByRole('dialog')).toBeVisible();
  });
});
