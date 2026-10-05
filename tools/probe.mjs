// Prints live race state from the running dev server. Usage: node tools/probe.mjs "<query>" [waitMs] [key]
import { chromium } from '@playwright/test';

const [query = '', wait = '3000', key = ''] = process.argv.slice(2);
const browser = await chromium.launch({ channel: 'msedge', args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => console.log('pageerror:', e.message));
page.on('console', (m) => {
  if (m.type() === 'error') console.log('console error:', m.text());
});
await page.goto(`http://localhost:5173/?${query}`);
if (key) await page.keyboard.press(key);
await page.waitForTimeout(Number(wait));
const state = await page.evaluate(() => {
  const r = window.miniracer.session.race;
  return {
    phase: r.phase,
    time: r.time,
    cars: r.cars.map((c) => ({ fin: c.finished, s: Math.round(c.loc.s), cross: c.crossings, v: Math.round(c.state.vx) })),
    results: document.querySelector('.results')?.className,
  };
});
console.log(JSON.stringify(state));
await browser.close();
