import { expect, test } from '@playwright/test';

interface Probe {
  profile: { money: number; admin: boolean; photos: { kind: string; data: string }[]; prefs: { trackId: string; weather: string } };
  session: { playerCar: number; trackDef: { id: string }; race: { weather: string; cars: { pitStops: number }[] } };
  view: { cameraMode: string };
}
const probe = <T>(page: import('@playwright/test').Page, fn: (p: Probe) => T): Promise<T> =>
  page.evaluate(`(${fn.toString()})(window.miniracer)`) as Promise<T>;

/** Opens the team tools login from the key icon and signs in. */
async function signIn(page: import('@playwright/test').Page, user: string, password: string): Promise<void> {
  await page.getByRole('button', { name: 'Team tools' }).click();
  const form = page.locator('.modal .tools-form');
  await expect(form).toBeVisible();
  await form.getByLabel('User name').fill(user);
  await form.getByLabel('Password').fill(password);
  await form.getByRole('button', { name: 'Unlock' }).click();
}

test.describe('Race day', () => {
  test('choose a circuit and rules, then race there', async ({ page }) => {
    await page.goto('/?fixture=built');
    expect(await page.locator('.track').count()).toBeGreaterThanOrEqual(4);
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

  test('the weather choice is used for the race', async ({ page }) => {
    await page.goto('/?fixture=built');
    const weather = page.locator('.choice[data-rule="weather"]');
    await expect(weather.locator('.btn')).toHaveCount(3);
    await weather.locator('.btn[data-value="rain"]').click();
    await expect(weather.locator('.btn.on')).toHaveAttribute('data-value', 'rain');
    expect(await probe(page, (p) => p.profile.prefs.weather)).toBe('rain');
    await page.locator('.home .actions .btn.go').click();
    await expect.poll(() => probe(page, (p) => p.session?.race.weather)).toBe('rain');
    await expect(page.locator('.session .weather')).toBeVisible();
  });

  test('any circuit in the list can be picked, including the last one', async ({ page }) => {
    await page.goto('/?fixture=built');
    const cards = page.locator('.track-grid .track');
    const last = cards.last();
    const name = (await last.locator('b').textContent())?.trim() ?? '';
    await last.scrollIntoViewIfNeeded();
    await last.click();
    await expect(last).toHaveClass(/\bon\b/);
    await expect(page.locator('.track-view .track-name')).toHaveText(new RegExp(`^${name}$`, 'i'));
    const chosen = await probe(page, (p) => p.profile.prefs.trackId);
    await page.locator('.home .actions .btn.go').click();
    await expect(page.locator('.session .track')).toHaveText(new RegExp(name, 'i'));
    expect(await probe(page, (p) => p.session.trackDef.id)).toBe(chosen);
  });

  test('radio messages show the speaker during a race with hazards', async ({ page }) => {
    await page.goto('/?fixture=built&hazards=10&skip=30');
    await page.locator('.home .actions .btn.go').click();
    await page.keyboard.press('2');
    await expect(page.locator('.radio .msg.driver canvas.face').first()).toBeVisible({ timeout: 30_000 });
    const msg = page.locator('.radio .msg.driver').first();
    await expect(msg.locator('.tag')).toHaveText(/^[A-Z]{3}$/);
    await expect(msg.locator('.text')).not.toHaveText('');
    expect(await page.locator('.radio .msg').count()).toBeLessThanOrEqual(4);
    // The face is drawn, not blank.
    const colours = await msg.locator('canvas.face').evaluate((c: HTMLCanvasElement) => {
      const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
      const seen = new Set<number>();
      for (let i = 0; i < d.length; i += 4) seen.add((d[i] << 16) | (d[i + 1] << 8) | d[i + 2]);
      return seen.size;
    });
    expect(colours).toBeGreaterThan(6);
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
    // Nothing on screen says "test mode" until the team has signed in.
    await expect(page.locator('.topbar')).not.toContainText(/test mode/i);
    await signIn(page, 'testdriver', 'miniracer');
    await expect(page.locator('.modal')).toHaveCount(0);
    await expect(page.locator('.topbar .money')).toHaveText(/test mode/i);
    await expect(page.getByRole('button', { name: /team tools/i })).toHaveClass(/\bon\b/);
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

  test('a wrong password does not unlock test mode', async ({ page }) => {
    await page.goto('/?fixture=built&screen=drivers&admin=1');
    // The old address-bar shortcut no longer works.
    await expect(page.locator('.topbar .money')).toHaveText('$300,000');
    await signIn(page, 'testdriver', 'wrong-password');
    await expect(page.locator('.modal .form-msg')).toContainText(/wrong user name or password/i);
    await expect(page.locator('.topbar .money')).toHaveText('$300,000');
    expect(await probe(page, (p) => p.profile.admin)).toBe(false);
    await expect(page.locator('.d-main .skill').first().getByRole('button', { name: '+' })).toBeDisabled();
    await page.locator('.modal').getByRole('button', { name: 'Cancel' }).click();
    await expect(page.locator('.modal')).toHaveCount(0);
  });

  test('leaving test mode from the team tools button', async ({ page }) => {
    await page.goto('/?fixture=built');
    await signIn(page, 'testdriver', 'miniracer');
    await expect(page.locator('.topbar .money')).toHaveText(/test mode/i);
    await page.getByRole('button', { name: /team tools/i }).click();
    await page.locator('.modal').getByRole('button', { name: 'Leave test mode' }).click();
    await expect(page.locator('.topbar .money')).toHaveText('$300,000');
    expect(await probe(page, (p) => p.profile.admin)).toBe(false);
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
