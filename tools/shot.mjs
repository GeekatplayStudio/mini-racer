// Takes screenshots of the running dev server for visual review.
// Usage: node tools/shot.mjs <name> "<query string>" [waitMs] [width] [height]
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const [name = 'shot', query = '', wait = '2500', width = '1280', height = '720'] = process.argv.slice(2);
const out = process.env.SHOT_DIR ?? 'reports/shots';
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({
  channel: 'msedge',
  args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: Number(width), height: Number(height) } });
const errors = [];
page.on('console', (m) => {
  if (m.type() === 'error' || m.type() === 'warning') errors.push(`${m.type()}: ${m.text()}`);
});
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
await page.goto(`http://localhost:5173/?${query}`);
// Optional steps before the picture: SHOT_CLICKS='selector|selector', each clicked in turn.
for (const sel of (process.env.SHOT_CLICKS ?? '').split('|').filter(Boolean)) {
  await page.waitForTimeout(350);
  if (sel.startsWith('hover:')) await page.locator(sel.slice(6)).first().hover();
  else await page.locator(sel).first().click();
}
await page.waitForTimeout(Number(wait));
await page.screenshot({ path: `${out}/${name}.png` });
const fps = await page.evaluate(
  () =>
    new Promise((resolve) => {
      let frames = 0;
      const start = performance.now();
      const tick = () => {
        frames++;
        if (performance.now() - start >= 1000) resolve(frames);
        else requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    }),
);
console.log(`${name}: ${fps} fps`);
if (errors.length) console.log(errors.slice(0, 12).join('\n'));
await browser.close();
