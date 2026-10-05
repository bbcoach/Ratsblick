import { chromium } from '/opt/node-tools/node_modules/playwright/index.mjs';
import { mkdirSync, rmSync } from 'node:fs';
rmSync('/tmp/mk/frames', { recursive: true, force: true }); mkdirSync('/tmp/mk/frames');
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
const p = await b.newPage({ viewport: { width: 1080, height: 1920 } });
await p.goto('file:///tmp/mk/li/anim.html'); await p.waitForTimeout(1200);
const fps = 30, dauer = await p.evaluate(() => DAUER), n = Math.round(fps * dauer);
const t0 = Date.now();
for (let i = 0; i < n; i++) {
  await p.evaluate((t) => render(t), i / fps);
  await p.screenshot({ path: `/tmp/mk/frames/f${String(i).padStart(4, '0')}.jpg`, type: 'jpeg', quality: 93 });
}
console.log(n, 'Bilder in', Math.round((Date.now() - t0) / 1000), 's');
await b.close();
