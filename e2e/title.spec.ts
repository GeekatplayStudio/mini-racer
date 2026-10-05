import { expect, test } from '@playwright/test';

interface Probe {
  title: { session: { trackDef: { id: string }; race: { phase: string; time: number; step(): void } } } | null;
  view: { cameraMode: string; focusCar: number } | null;
}
const probe = <T>(page: import('@playwright/test').Page, fn: (p: Probe) => T): Promise<T> =>
  page.evaluate(`(${fn.toString()})(window.miniracer)`) as Promise<T>;

test.describe('Title screen', () => {
  test('a visitor sees the title, a live race behind it, and the sign-in panel', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.title-logo')).toHaveText(/miniracer/i);
    await expect(page.locator('.title-panel').getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'User name' })).toBeVisible();
    await expect(page.locator('.title-caption')).toContainText(/live/i);
    // The race is real and running.
    const t0 = await probe(page, (p) => p.title?.session.race.time ?? -1);
    await page.waitForTimeout(1200);
    const t1 = await probe(page, (p) => p.title?.session.race.time ?? -1);
    expect(t1).toBeGreaterThan(t0 + 0.5);
    // The team screens stay hidden until the visitor chooses.
    await expect(page.locator('.topbar')).toBeHidden();
  });

  test('register asks for the password twice, and says when the server cannot be reached', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('tab', { name: 'Register' }).click();
    await page.getByRole('textbox', { name: 'User name' }).fill('new_team');
    await page.getByRole('textbox', { name: 'Password', exact: true }).fill('fast-laps-2026');
    await page.getByRole('textbox', { name: 'Password again' }).fill('different-2026');
    await page.getByRole('button', { name: 'Create account' }).click();
    await expect(page.locator('.title-msg')).toContainText(/not the same/i);
    await page.getByRole('textbox', { name: 'Password again' }).fill('fast-laps-2026');
    await page.getByRole('button', { name: 'Create account' }).click();
    // The test page has no game server behind it.
    await expect(page.locator('.title-msg.bad')).toBeVisible();
    await expect(page.locator('.title-screen')).toBeVisible();
  });

  test('play offline goes to the team, and the logo brings the title back', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: /play offline/i }).click();
    await expect(page.locator('.title-screen')).toHaveCount(0);
    await expect(page.locator('.topbar')).toBeVisible();
    await expect(page.locator('.home')).toBeVisible();
    await page.locator('.topbar .brand').click();
    await expect(page.locator('.title-screen')).toBeVisible();
  });

  test('the camera cuts between cars and views, and a new race follows the flag', async ({ page }) => {
    await page.goto('/');
    const shots = new Set<string>();
    for (let i = 0; i < 12; i++) {
      shots.add(await page.evaluate(() => {
        const t = (window as unknown as { miniracer: { title: { view: { cameraMode: string; focusCar: number } } } }).miniracer.title;
        return `${t.view.cameraMode}:${t.view.focusCar}`;
      }));
      await page.waitForTimeout(1500);
    }
    expect(shots.size).toBeGreaterThanOrEqual(2);
    // Run the demo race to the flag; the next one starts on another circuit.
    const first = await probe(page, (p) => p.title?.session.trackDef.id ?? '');
    await page.evaluate(() => {
      const race = (window as unknown as { miniracer: Probe }).miniracer.title?.session.race;
      for (let i = 0; i < 240 * 900 && race && race.phase !== 'finished'; i++) race.step();
    });
    await expect.poll(() => probe(page, (p) => p.title?.session.trackDef.id ?? ''), { timeout: 15_000 }).not.toBe(first);
  });
});
