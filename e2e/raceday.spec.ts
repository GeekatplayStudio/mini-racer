import { expect, test } from '@playwright/test';

interface Probe {
  profile: { money: number; photos: { kind: string; data: string }[] };
  session: { playerCar: number; race: { cars: { pitStops: number }[] } };
  view: { cameraMode: string };
}
const probe = <T>(page: import('@playwright/test').Page, fn: (p: Probe) => T): Promise<T> =>
  page.evaluate(`(${fn.toString()})(window.miniracer)`) as Promise<T>;

test.describe('Race day', () => {
  test('choose a circuit and rules, then race there', async ({ page }) => {
    await page.goto('/?fixture=built');
    await expect(page.locator('.track')).toHaveCount(4);
    await page.locator('.track', { hasText: 'Styrian Hills' }).click();
    await expect(page.locator('.track.on')).toContainText('Styrian Hills');
    await page.locator('.choice', { hasText: 'Distance' }).getByRole('button', { name: /feature/i }).click();
    await page.locator('.choice', { hasText: 'Tyre and fuel use' }).getByRole('button', { name: /fast/i }).click();
    await page.locator('.choice', { hasText: 'Pit stops' }).getByRole('button', { name: /pit wall/i }).click();
    await expect(page.locator('.home')).toContainText(/15 laps/i);
    await expect(page.locator('.home')).toContainText(/you call the stops/i);
    await page.locator('.home .actions .btn.go').click();
    await expect(page.locator('.session .track')).toHaveText(/styrian hills/i);
    await expect(page.locator('.tower-head')).toContainText('/15');
    await expect(page.locator('.pitline')).toContainText(/your call/i);
  });

  test('pit-wall orders: push, and box brings the car into the pits', async ({ page }) => {
    await page.goto('/?fixture=built&pit=manual&skip=20');
    await page.locator('.home .actions .btn.go').click();
    await expect(page.locator('.cmdbar .cmd')).toHaveCount(8);
    await page.locator('.cmd', { hasText: 'Push' }).click();
    await expect(page.locator('.radio')).toContainText(/push now/i);
    await expect(page.locator('.cmd.on', { hasText: 'Push' })).toBeVisible({ timeout: 15_000 });
    await page.keyboard.press('b');
    await expect(page.locator('.radio')).toContainText(/box this lap/i);
    await page.keyboard.press('4');
    await expect(page.locator('.pitline')).toContainText(/in the box/i, { timeout: 40_000 });
    await expect.poll(() => probe(page, (p) => p.session.race.cars[p.session.playerCar].pitStops), { timeout: 30_000 }).toBe(1);
  });

  test('driver view camera, and an in-game dialog to leave the race', async ({ page }) => {
    const dialogs: string[] = [];
    page.on('dialog', (d) => {
      dialogs.push(d.message());
      void d.dismiss();
    });
    await page.goto('/?fixture=built&skip=15');
    await page.locator('.home .actions .btn.go').click();
    await page.keyboard.press('c');
    expect(await probe(page, (p) => p.view.cameraMode)).toBe('pov');
    await page.keyboard.press('Escape');
    await expect(page.locator('.modal')).toContainText(/retire from the race/i);
    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.locator('.modal')).toHaveCount(0);
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Retire' }).click();
    await expect(page.locator('.home')).toBeVisible();
    // No browser dialog was used anywhere.
    expect(dialogs).toEqual([]);
  });

  test('a finished race is written to the history with a finish-line photo', async ({ page }) => {
    await page.goto('/?fixture=built&skip=400');
    await page.locator('.home .actions .btn.go').click();
    await expect(page.locator('.results')).toBeVisible({ timeout: 20_000 });
    await page.getByRole('button', { name: /continue/i }).click();
    await page.getByRole('button', { name: 'History' }).click();
    await expect(page.locator('.hi-right .title')).toContainText('1 sessions');
    await expect(page.locator('.races-table')).toContainText('Kentish Bowl');
    await expect(page.locator('.races-table')).toContainText(/P\d+\/10/);
    await expect(page.locator('.hi-left')).toContainText(/prize money/i);
  });

  test('watching the finish live takes a finish-line photo', async ({ page }) => {
    await page.goto('/?fixture=built&laps=1&skip=30');
    await page.locator('.home .actions .btn.go').click();
    await page.keyboard.press('4');
    await expect(page.locator('.results')).toBeVisible({ timeout: 45_000 });
    await expect(page.locator('.results .finish-photo')).toBeVisible();
    const photo = await probe(page, (p) => p.profile.photos[0]);
    expect(photo.kind).toBe('finish');
    expect(photo.data.startsWith('data:image/jpeg')).toBe(true);
  });
});

test.describe('Team tools', () => {
  test('test mode makes parts free and unlocks driver skills', async ({ page }) => {
    await page.goto('/?fixture=built&screen=drivers');
    await expect(page.locator('.d-main .skill').first().getByRole('button', { name: '+' })).toBeDisabled();
    await page.getByRole('button', { name: /test mode/i }).click();
    await expect(page.locator('.topbar .money')).toHaveText(/test mode/i);
    await page.locator('.d-main .skill').first().getByRole('button', { name: '+' }).click();
    await expect(page.locator('.d-main .skill').first().locator('span').last()).toHaveText('10');
    await page.getByRole('button', { name: 'Garage' }).click();
    await page.locator('.slot', { hasText: 'Rear wing' }).click();
    // Every part is affordable now, including the dearest one not already fitted.
    await expect(page.locator('.part .buy .btn[title="Not enough money"]')).toHaveCount(0);
    await page.locator('.part:not(.fitted)', { hasText: 'GTX-1000' }).locator('.buy .btn', { hasText: 'New' }).click();
    await expect(page.locator('.topbar .money')).toHaveText(/test mode/i);
    await expect(page.locator('.slot.on .fit')).toContainText(/GTX-1000/i);
  });

  test('auto build picks parts for the budget after an in-game confirmation', async ({ page }) => {
    await page.goto('/?fixture=empty&screen=garage');
    await page.locator('.part', { hasText: 'R9 LMS GT3 Evo II shell' }).locator('.buy .btn', { hasText: 'Used' }).click();
    await page.getByRole('button', { name: /auto build/i }).click();
    await expect(page.locator('.modal')).toContainText(/best parts your budget buys/i);
    await page.locator('.modal').getByRole('button', { name: 'Auto build' }).click();
    await expect(page.locator('.car-head .badge')).toHaveText(/race legal/i, { timeout: 30_000 });
    const money = await probe(page, (p) => p.profile.money);
    expect(money).toBeGreaterThanOrEqual(10000);
    expect(money).toBeLessThan(60000);
  });

  test('team photo of the driver beside the car goes into the album', async ({ page }) => {
    await page.goto('/?fixture=built');
    await page.getByRole('button', { name: /team photo/i }).click();
    await page.getByRole('button', { name: /take photo/i }).click();
    await expect(page.locator('.toast')).toContainText(/photo saved/i);
    const photo = await probe(page, (p) => p.profile.photos[0]);
    expect(photo.kind).toBe('team');
    expect(photo.data.startsWith('data:image/jpeg')).toBe(true);
    expect(photo.data.length).toBeGreaterThan(5000);
    await page.getByRole('button', { name: 'Back' }).click();
    await page.getByRole('button', { name: 'History' }).click();
    await expect(page.locator('.album .shot')).toHaveCount(1);
    await page.locator('.album .shot').click();
    await expect(page.locator('.modal img')).toBeVisible();
  });
});
