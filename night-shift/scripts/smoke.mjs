import puppeteer from 'puppeteer-core';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../dist', import.meta.url));
const OUT = '/opt/cursor/artifacts/night-shift';
mkdirSync(OUT, { recursive: true });

const mime = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.map': 'application/json',
};

const server = createServer((req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  let path = join(ROOT, decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname));
  if (!existsSync(path) || statSync(path).isDirectory()) path = join(ROOT, 'index.html');
  try {
    const data = readFileSync(path);
    res.writeHead(200, { 'Content-Type': mime[extname(path)] || 'application/octet-stream' });
    res.end(data);
  } catch {
    res.writeHead(404);
    res.end('missing');
  }
});

await new Promise((r) => server.listen(4177, '127.0.0.1', r));

const errors = [];
const logs = [];
const browser = await puppeteer.launch({
  executablePath: '/usr/bin/google-chrome',
  headless: true,
  args: [
    '--no-sandbox',
    '--disable-gpu',
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--window-size=1280,720',
  ],
  defaultViewport: { width: 1280, height: 720 },
});

const page = await browser.newPage();
page.on('pageerror', (err) => errors.push(`pageerror: ${err}`));
page.on('console', (msg) => {
  const text = msg.text();
  logs.push(`[${msg.type()}] ${text}`);
  if (msg.type() === 'error') errors.push(text);
});

await page.goto('http://127.0.0.1:4177/', { waitUntil: 'networkidle0', timeout: 30000 });
await page.screenshot({ path: join(OUT, '01-boot.png') });

const bootState = await page.evaluate(() => ({
  hasBtn: !!document.getElementById('start-btn'),
  bootText: document.querySelector('.boot-copy')?.textContent || '',
  canvasCount: document.querySelectorAll('canvas').length,
  visualHarnessInstalled: !!window.__nightShiftVisual,
}));
console.log('bootState', bootState);

await page.click('#start-btn');
await new Promise((r) => setTimeout(r, 2500));
await page.screenshot({ path: join(OUT, '02-after-click.png') });

const after = await page.evaluate(() => ({
  bootHidden: document.getElementById('boot')?.classList.contains('hidden'),
  bootText: document.querySelector('.boot-copy')?.textContent || '',
  btnText: document.getElementById('start-btn')?.textContent || '',
  canvasCount: document.querySelectorAll('canvas').length,
  mode: document.querySelector('[data-mode]')?.textContent || '',
  fps: document.querySelector('[data-fps]')?.textContent || '',
  bodyClass: document.body.className,
  visualHarnessInstalled: !!window.__nightShiftVisual,
}));
console.log('after', after);

// Try force-start if pointer-lock blocked hide
if (!after.bootHidden) {
  await page.evaluate(async () => {
    const btn = document.getElementById('start-btn');
    if (btn && !btn.disabled) btn.click();
  });
  await new Promise((r) => setTimeout(r, 1500));
}

await page.keyboard.press('KeyF');
await page.mouse.click(640, 360, { button: 'left' });
await new Promise((r) => setTimeout(r, 1000));
await page.screenshot({ path: join(OUT, '03-interact.png') });

const report = {
  ok: after.canvasCount > 0 && errors.length === 0 && !bootState.visualHarnessInstalled && !after.visualHarnessInstalled,
  errors,
  logs: logs.slice(-40),
  bootState,
  after,
};
writeFileSync(join(OUT, 'smoke-report.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));

await browser.close();
server.close();
process.exit(report.ok ? 0 : 1);
