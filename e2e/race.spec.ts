import { expect, test } from '@playwright/test';

interface Probe {
  session: {
    race: { phase: string; time: number; cars: { state: { x: number; vx: number } }[] };
  };
  view: { focusCar: number; cameraMode: string };
}

declare global {
  interface Window {
    miniracer: Probe;
  }
}

test.describe('Race screen', () => {
  test('loads, shows the HUD and renders a non-blank 3D view', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });
    await page.goto('/?quick=1&seed=5&grid=6&laps=1');
    await expect(page.locator('.tower-row')).toHaveCount(6);
    await expect(page.locator('.session .track')).toHaveText(/kentish bowl/i);
    await expect(page.locator('.lights')).toBeVisible();

    // The low-resolution canvas must contain a real picture, not one flat colour.
    // Read inside an animation frame, straight after the game has drawn: a
    // WebGL canvas is cleared once the frame has been presented.
    const colours = await page.evaluate(
      () =>
        new Promise<{ count: number; height: number }>((resolve) => {
          requestAnimationFrame(() => {
            const src = document.getElementById('view') as HTMLCanvasElement;
            const copy = document.createElement('canvas');
            copy.width = src.width;
            copy.height = src.height;
            const ctx = copy.getContext('2d')!;
            ctx.drawImage(src, 0, 0);
            const data = ctx.getImageData(0, 0, copy.width, copy.height).data;
            const seen = new Set<number>();
            for (let i = 0; i < data.length; i += 4 * 97) seen.add((data[i] << 16) | (data[i + 1] << 8) | data[i + 2]);
            resolve({ count: seen.size, height: src.height });
          });
        }),
    );
    expect(colours.height).toBeLessThanOrEqual(720);
    expect(colours.count).toBeGreaterThan(12);
    expect(errors).toEqual([]);
  });

  test('starts the race after the lights and the cars move', async ({ page }) => {
    await page.goto('/?quick=1&seed=5&grid=6&laps=1&skip=7');
    await expect.poll(() => page.evaluate(() => window.miniracer.session.race.phase), { timeout: 15_000 }).toBe('racing');
    await expect(page.locator('.lights')).toBeHidden();
    await expect
      .poll(() => page.evaluate(() => window.miniracer.session.race.cars[0].state.vx), { timeout: 15_000 })
      .toBeGreaterThan(20);
    await expect(page.locator('.dash .speed')).not.toHaveText('0');
  });

  test('keyboard controls switch car, camera and pause', async ({ page }) => {
    await page.goto('/?quick=1&seed=5&grid=6&laps=1&skip=12');
    const focusBefore = await page.evaluate(() => window.miniracer.view.focusCar);
    await page.keyboard.press('Tab');
    await expect.poll(() => page.evaluate(() => window.miniracer.view.focusCar)).not.toBe(focusBefore);
    await page.keyboard.press('c');
    await expect.poll(() => page.evaluate(() => window.miniracer.view.cameraMode)).toBe('pov');
    await page.keyboard.press('c');
    await expect.poll(() => page.evaluate(() => window.miniracer.view.cameraMode)).toBe('overview');
    await page.keyboard.press('p');
    const t0 = await page.evaluate(() => window.miniracer.session.race.time);
    await page.waitForTimeout(500);
    const t1 = await page.evaluate(() => window.miniracer.session.race.time);
    expect(t1).toBe(t0);
    await expect(page.locator('.session')).toContainText(/paused/i);
  });

  test('shows the result table when the race ends', async ({ page }) => {
    await page.goto('/?quick=1&seed=5&grid=4&laps=1&skip=75');
    await page.keyboard.press('3');
    await expect(page.locator('.results')).toBeVisible({ timeout: 45_000 });
    await expect(page.locator('.results tr')).toHaveCount(4);
    await expect(page.locator('.results h1')).toHaveText(/race result/i);
  });
});
