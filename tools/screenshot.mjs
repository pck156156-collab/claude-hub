// Open a page in headless Chromium, report console errors, save a screenshot.
// Usage: node tools/screenshot.mjs templates/phaser-2d [out.png] [--wait 1500]
import { createServer } from 'vite';
import { chromium } from 'playwright-core';

const args = process.argv.slice(2);
const waitIdx = args.indexOf('--wait');
const wait = waitIdx >= 0 ? Number(args.splice(waitIdx, 2)[1]) : 1500;
const [page = 'templates/phaser-2d', out = `${page.replace(/\W+/g, '-')}.png`] = args;

const server = await createServer({ logLevel: 'silent' });
await server.listen();
const url = `${server.resolvedUrls.local[0]}${page.replace(/\/?$/, '/')}`;

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const tab = await browser.newPage({ viewport: { width: 960, height: 540 } });
const errors = [];
const ignore = (msg) => msg.includes('favicon.ico');
tab.on('pageerror', (e) => errors.push(e.message));
tab.on('console', (m) => m.type() === 'error' && errors.push(`${m.text()} ${m.location().url || ''}`.trim()));
tab.on('response', (r) => r.status() >= 400 && !r.url().endsWith('/favicon.ico') && errors.push(`${r.status()} ${r.url()}`));

await tab.goto(url);
await tab.waitForTimeout(wait);
await tab.screenshot({ path: out });
await browser.close();
await server.close();

console.log(`screenshot: ${out}`);
const real = errors.filter((e) => !ignore(e));
if (real.length) {
  console.error(`errors:\n  ${real.join('\n  ')}`);
  process.exit(1);
}
