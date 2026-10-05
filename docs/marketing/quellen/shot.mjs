import { chromium } from '/opt/node-tools/node_modules/playwright/index.mjs';
import { readFileSync, writeFileSync } from 'node:fs';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
for (const [cls, w, h, name] of [['wide', 1200, 627, 'linkedin-wahlheimat-1200x627'], ['sq', 1080, 1080, 'linkedin-wahlheimat-1080x1080'], ['story', 1080, 1920, 'story-wahlheimat-1080x1920']]) {
  const p = await b.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 2 });
  await p.goto('file:///tmp/mk/li/li.html'); await p.evaluate((c) => { document.body.className = c; }, cls); await p.waitForTimeout(900);
  await p.screenshot({ path: `/tmp/mk/${name}.png` });
}
await b.close();
