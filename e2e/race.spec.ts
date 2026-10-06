import { expect, test } from '@playwright/test';

interface Probe {
  session: {
    playerCar: number;
    race: { phase: string; time: number; cars: { id: number; state: { x: number; y: number; vx: number; heading: number }; manual: object | null }[] };
    entries: { voice: { label: string; tune: number } }[];
  };
  sound: { heard: number[] };
  view: { focusCar: number; cameraMode: string; followHeading: boolean; camera: { position: { x: number; y: number; z: number } } };
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

  test('the player can take the wheel and drive with W A S D', async ({ page }) => {
    await page.goto('/?quick=1&seed=5&grid=6&laps=2');
    const mine = (): Promise<{ manual: boolean; vx: number; heading: number }> =>
      page.evaluate(() => {
        const s = window.miniracer.session;
        const car = s.race.cars[s.playerCar];
        return { manual: car.manual !== null, vx: car.state.vx, heading: car.state.heading };
      });
    // Taken on the grid: the driver keeps the car until the lights go out.
    await page.keyboard.press('t');
    expect((await mine()).manual).toBe(true);
    await expect(page.locator('.dash .wheel')).toContainText(/on green/i);
    expect(await page.evaluate(() => window.miniracer.view.followHeading)).toBe(true);
    await expect.poll(() => page.evaluate(() => window.miniracer.session.race.phase), { timeout: 15_000 }).toBe('racing');
    await expect(page.locator('.dash .wheel')).toContainText(/you drive/i);
    expect((await mine()).vx).toBeLessThan(1);
    await page.keyboard.down('w');
    await expect.poll(async () => (await mine()).vx).toBeGreaterThan(12);
    const before = (await mine()).heading;
    await page.keyboard.down('d');
    await expect.poll(async () => (await mine()).heading - before).toBeGreaterThan(0.08);
    await page.keyboard.up('d');
    await page.keyboard.up('w');
    const fast = (await mine()).vx;
    await page.keyboard.down('s');
    await expect.poll(async () => (await mine()).vx).toBeLessThan(fast - 5);
    await page.keyboard.up('s');
    await page.keyboard.press('t');
    expect((await mine()).manual).toBe(false);
    await expect(page.locator('.dash .wheel')).toBeHidden();
  });

  test('the mouse turns and zooms the race camera', async ({ page }) => {
    await page.goto('/?quick=1&seed=5&grid=6&laps=1&skip=12');
    await page.keyboard.press('p');
    const camera = (): Promise<{ x: number; y: number; z: number }> =>
      page.evaluate(() => ({ ...window.miniracer.view.camera.position }));
    const start = await camera();
    await page.mouse.move(640, 300);
    await page.mouse.down();
    await page.mouse.move(800, 300, { steps: 5 });
    await page.mouse.up();
    await expect.poll(async () => Math.hypot((await camera()).x - start.x, (await camera()).z - start.z)).toBeGreaterThan(20);
    const turned = await camera();
    await page.mouse.wheel(0, 500);
    await expect.poll(async () => (await camera()).y).toBeGreaterThan(turned.y * 1.3);
    await page.keyboard.press('v');
    await expect.poll(async () => (await camera()).y).toBeCloseTo(start.y, 0);
  });

  test('every car has its own engine, and the nearest ones are heard', async ({ page }) => {
    await page.goto('/?quick=1&seed=5&grid=10&laps=2&skip=20');
    // Sound starts on the first key press.
    await page.keyboard.press('Home');
    await expect.poll(() => page.evaluate(() => window.miniracer.sound.heard.length)).toBe(6);
    const check = await page.evaluate(() => {
      const m = window.miniracer;
      const cars = m.session.race.cars;
      const me = cars[m.view.focusCar].state;
      const nearest = [...cars]
        .sort((a, b) => Math.hypot(a.state.x - me.x, a.state.y - me.y) - Math.hypot(b.state.x - me.x, b.state.y - me.y))
        .slice(0, 6)
        .map((c) => c.id);
      return { heard: m.sound.heard, nearest, focus: m.view.focusCar, voices: m.session.entries.map((e) => `${e.voice.label} ${e.voice.tune}`) };
    });
    expect(check.heard).toContain(check.focus);
    expect([...check.heard].sort()).toEqual([...check.nearest].sort());
    expect(new Set(check.voices).size).toBe(check.voices.length);
  });

  test('shows the result table when the race ends', async ({ page }) => {
    await page.goto('/?quick=1&seed=5&grid=4&laps=1&skip=75');
    await page.keyboard.press('3');
    await expect(page.locator('.results')).toBeVisible({ timeout: 45_000 });
    await expect(page.locator('.results tr')).toHaveCount(4);
    await expect(page.locator('.results h1')).toHaveText(/race result/i);
  });
});
