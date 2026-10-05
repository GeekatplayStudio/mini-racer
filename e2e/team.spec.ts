import { expect, test } from '@playwright/test';

interface Probe {
  profile: { money: number; races: number; cars: { parts: Record<string, unknown> }[]; drivers: { def: { name: string; racesCompleted: number } }[] };
  session: { counts: boolean; race: { phase: string } } | null;
}
const probe = <T>(page: import('@playwright/test').Page, fn: (p: Probe) => T): Promise<T> =>
  page.evaluate(`(${fn.toString()})(window.miniracer)`) as Promise<T>;

test.describe('Garage', () => {
  test('builds a race-legal car from an empty garage within the starting budget', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto('/?fixture=empty&screen=garage');
    await expect(page.locator('.topbar .money')).toHaveText('$300,000');
    await expect(page.locator('.g-right .title')).toContainText(/choose a chassis/i);

    // Buy a worn Audi shell.
    await page.locator('.part', { hasText: 'R9 LMS GT3 Evo II shell' }).locator('.buy .btn', { hasText: 'Worn' }).click();
    await expect(page.locator('.car-head .name')).toContainText(/auda/i);
    await expect(page.locator('.topbar .money')).toHaveText('$260,800');
    await expect(page.locator('.car-head .badge')).toContainText(/parts missing/i);
    await expect(page.locator('.g-stats')).toContainText(/fit an engine/i);

    // An engine from another maker is locked out.
    await page.locator('.slot', { hasText: 'Engine' }).first().click();
    const bmw = page.locator('.part', { hasText: 'P85 3.0L' });
    await expect(bmw).toHaveClass(/locked/);
    await expect(bmw.locator('.buy .btn').first()).toBeDisabled();

    // One click buys the cheapest worn part for every empty slot.
    expect(await page.locator('.slot').count()).toBeGreaterThanOrEqual(59);
    await page.locator('.kit .btn', { hasText: 'Worn' }).click();
    await expect(page.locator('.car-head .badge')).toHaveText(/race legal/i);
    await expect(page.locator('.slot .fit.none')).toHaveCount(0);
    await expect(page.locator('.g-stats')).toContainText(/hp/i);
    await expect(page.locator('.g-stats')).toContainText(/lap estimate/i);
    expect(await probe(page, (p) => p.profile.money)).toBeGreaterThan(0);
    expect(await probe(page, (p) => Object.keys(p.profile.cars[0].parts).length)).toBeGreaterThanOrEqual(61);
    expect(errors).toEqual([]);
  });

  test('previews a part on hover, fits it on click and charges the swap cost', async ({ page }) => {
    await page.goto('/?fixture=built&screen=garage');
    await page.locator('.slot', { hasText: 'Rear wing' }).click();
    const card = page.locator('.part', { hasText: 'GTX-1000' });
    await card.locator('.buy .btn', { hasText: 'New' }).hover();
    await expect(page.locator('.g-stats .title')).toContainText(/preview/i);
    await expect(page.locator('.g-stats .delta.good').first()).toBeVisible();
    const before = await probe(page, (p) => p.profile.money);
    await card.locator('.buy .btn', { hasText: 'New' }).click();
    await expect(page.locator('.slot.on .fit')).toContainText('GTX-1000');
    await expect(card).toHaveClass(/fitted/);
    const after = await probe(page, (p) => p.profile.money);
    // The old wing is traded in, so the balance moves by the difference.
    expect(after).not.toBe(before);
    expect(Math.abs(before - after)).toBeLessThan(7900);
    // No real brand names on screen.
    await expect(page.locator('.g-right')).not.toContainText(/APR Performance|Voltex|Verus/);
  });

  test('3D view: lift the body, rotate, zoom and pan without errors', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto('/?fixture=built&screen=garage');
    await page.getByRole('button', { name: /lift body/i }).click();
    await expect(page.getByRole('button', { name: /lower body/i })).toBeVisible();
    await page.mouse.move(640, 380);
    await page.mouse.down();
    await page.mouse.move(760, 330, { steps: 6 });
    await page.mouse.up();
    await page.mouse.wheel(0, -400);
    await page.mouse.down({ button: 'right' });
    await page.mouse.move(700, 360, { steps: 4 });
    await page.mouse.up({ button: 'right' });
    await page.getByRole('button', { name: /reset view/i }).click();
    await page.waitForTimeout(300);
    expect(errors).toEqual([]);
  });
});

test.describe('Car computer', () => {
  test('editing the engine map changes power on the dyno and is saved on the car', async ({ page }) => {
    await page.goto('/?fixture=built&screen=tune');
    await expect(page.locator('.t-left .title')).toContainText(/engine computer/i);
    await expect(page.locator('.ecu-table .col')).toHaveCount(8);
    const power = () => page.locator('.t-right .title span').last().innerText();
    const before = await power();
    // Retard the ignition a long way at the top of the rev range: power must fall.
    const cells = page.locator('.ecu-table .cell');
    for (const column of [5, 6, 7]) await cells.nth(column).click({ button: 'right', modifiers: ['Shift'] });
    for (const column of [5, 6, 7]) await cells.nth(column).click({ button: 'right', modifiers: ['Shift'] });
    const after = await power();
    expect(parseInt(after, 10)).toBeLessThan(parseInt(before, 10));
    expect(await probe(page, (p) => (p.profile.cars[0] as unknown as { ecu?: { ign: number[] } }).ecu?.ign.length)).toBe(8);

    // Far too much advance: the computer reports knock.
    for (let i = 0; i < 8; i++) await cells.nth(6).click({ modifiers: ['Shift'] });
    await expect(page.locator('.ecu-table .read.bad').first()).toContainText(/knock/i);
    await expect(page.locator('.t-right')).toContainText(/retard the ignition/i);

    // The safe base map clears it.
    await page.getByRole('button', { name: /load safe base map/i }).click();
    await expect(page.locator('.ecu-table .read.bad')).toHaveCount(0);
    await expect(page.locator('.t-right')).toContainText(/no warnings/i);
  });

  test('driver switches, dyno session and spec sheet', async ({ page }) => {
    await page.goto('/?fixture=built&screen=tune');
    const tc = page.locator('.switch', { hasText: 'Traction control' });
    await expect(tc.locator('b')).toHaveText('8 / 12');
    await tc.getByRole('button', { name: '+' }).click();
    await expect(page.locator('.switch', { hasText: 'Traction control' }).locator('b')).toHaveText('9 / 12');
    await page.getByRole('button', { name: /dyno session/i }).click();
    await expect(page.locator('.topbar .money')).toHaveText('$298,500');
    await expect(page.locator('.readout .good').first()).toBeVisible();
    await page.getByRole('button', { name: /full spec sheet/i }).click();
    await expect(page.locator('.sheet .rating b')).toHaveText(/^\d+$/);
    await expect(page.locator('.sheet-grid')).toContainText(/fuel per lap/i);
    await expect(page.locator('.sheet-scores .score')).toHaveCount(6);
  });
});

test.describe('Drivers', () => {
  test('creates a driver from 100 points and locks the allocation', async ({ page }) => {
    await page.goto('/?fixture=empty&screen=drivers');
    await expect(page.locator('.points')).toHaveText('100');
    const sign = page.getByRole('button', { name: /sign driver/i });
    await expect(sign).toBeDisabled();
    await page.getByPlaceholder(/driver name/i).fill('Nina Speed');

    // Four skills at 9 and eight at 8 make exactly 100.
    const rows = page.locator('.d-main .skill');
    await expect(rows).toHaveCount(12);
    for (let i = 0; i < 12; i++) {
      // Click the pip for the wanted level.
      await rows.nth(i).locator('.pips i').nth((i < 4 ? 9 : 8) - 1).click();
    }
    await expect(page.locator('.points')).toHaveText('0');
    // The pool cannot be overspent.
    await expect(rows.nth(0).getByRole('button', { name: '+' })).toBeDisabled();
    await sign.click();

    await expect(page.locator('.roster.on')).toContainText('Nina Speed');
    await expect(page.locator('.d-main .title')).toContainText('Nina Speed');
    // Signed: no way to lower a skill, and nothing to add yet.
    await expect(page.locator('.d-main .skill').getByRole('button', { name: '-' })).toHaveCount(0);
    await expect(page.locator('.d-main .skill').first().getByRole('button', { name: '+' })).toBeDisabled();
    expect(await probe(page, (p) => p.profile.drivers[0].def.name)).toBe('Nina Speed');
  });
});

test.describe('Race entry', () => {
  test('needs a car and a driver before the race can start', async ({ page }) => {
    await page.goto('/?fixture=empty');
    await expect(page.locator('.home .actions .btn.go')).toBeDisabled();
    await expect(page.locator('.home .actions .btn').first()).toBeDisabled();
    await expect(page.locator('.home')).toContainText(/no car yet/i);
    await expect(page.locator('.home')).toContainText(/no driver yet/i);
  });

  test('charges the fee, runs the race, pays the prize and returns to the team screen', async ({ page }) => {
    // skip=400 fast-forwards the simulation past the finish.
    await page.goto('/?fixture=built&skip=400');
    await page.getByRole('button', { name: /race\s+-\$5,500/i }).click();
    await expect(page.locator('.tower-row')).toHaveCount(10);
    await expect(page.locator('.results')).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('.results .reward')).toContainText(/you finished p\d+/i);
    await expect(page.locator('.results .prize')).toContainText(/prize \$/i);
    const state = await probe(page, (p) => ({ money: p.profile.money, races: p.profile.races, done: p.profile.drivers[0].def.racesCompleted }));
    expect(state.races).toBe(1);
    expect(state.done).toBe(1);
    expect(state.money).toBeGreaterThan(300000 - 5500);
    await page.getByRole('button', { name: /continue/i }).click();
    await expect(page.locator('.home')).toBeVisible();
    await expect(page.locator('.home .title')).toContainText(/1 races/i);
  });

  test('practice is free and pays nothing', async ({ page }) => {
    await page.goto('/?fixture=built&skip=400');
    await page.getByRole('button', { name: /practice/i }).click();
    await expect(page.locator('.tower-row')).toHaveCount(1);
    await expect(page.locator('.results')).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('.results .reward')).toContainText(/no fee, no prize/i);
    expect(await probe(page, (p) => ({ money: p.profile.money, races: p.profile.races }))).toEqual({ money: 300000, races: 0 });
  });
});
