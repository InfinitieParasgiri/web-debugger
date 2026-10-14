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
