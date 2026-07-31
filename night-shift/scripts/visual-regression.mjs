import puppeteer from 'puppeteer-core';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compareDirectories } from './compare-screenshots.mjs';

const ROOT = fileURLToPath(new URL('../dist', import.meta.url));
const VISUAL_ROOT = fileURLToPath(new URL('../tests/visual', import.meta.url));
const CAMERAS = join(VISUAL_ROOT, 'cameras.json');
const TMP = join(VISUAL_ROOT, '__tmp__');
const BASELINES = join(VISUAL_ROOT, 'baselines');
const PORT = 4178;
const VIEWPORT = { width: 1280, height: 720 };

const mime = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.map': 'application/json',
  '.json': 'application/json',
  '.png': 'image/png',
};

function parseArgs(argv) {
  const options = { update: false, threshold: 0.02, maeThreshold: 0.02, pixelThreshold: 24 };
  for (const arg of argv) {
    if (arg === '--update') options.update = true;
    else if (arg.startsWith('--threshold=')) options.threshold = Number(arg.slice('--threshold='.length));
    else if (arg.startsWith('--mae-threshold=')) options.maeThreshold = Number(arg.slice('--mae-threshold='.length));
    else if (arg.startsWith('--pixel-threshold=')) options.pixelThreshold = Number(arg.slice('--pixel-threshold='.length));
  }
  return options;
}

function makeServer() {
  return createServer((req, res) => {
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
}

function loadCameras() {
  const cameras = JSON.parse(readFileSync(CAMERAS, 'utf8'));
  if (!Array.isArray(cameras) || cameras.length === 0) {
    throw new Error(`${CAMERAS} must contain at least one camera fixture`);
  }
  return cameras;
}

const options = parseArgs(process.argv.slice(2));
const errors = [];
const logs = [];
const cameras = loadCameras();

rmSync(TMP, { recursive: true, force: true });
mkdirSync(TMP, { recursive: true });
mkdirSync(BASELINES, { recursive: true });

const server = makeServer();
await new Promise((resolve) => server.listen(PORT, '127.0.0.1', resolve));

let browser;
try {
  browser = await puppeteer.launch({
    executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome',
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-gpu',
      '--use-gl=angle',
      '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader',
      `--window-size=${VIEWPORT.width},${VIEWPORT.height}`,
    ],
    defaultViewport: VIEWPORT,
  });

  const page = await browser.newPage();
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.stack || err}`));
  page.on('console', (msg) => {
    const text = msg.text();
    logs.push(`[${msg.type()}] ${text}`);
    if (msg.type() === 'error') errors.push(text);
  });

  await page.goto(`http://127.0.0.1:${PORT}/#visual=1`, { waitUntil: 'networkidle0', timeout: 30000 });
  await page.waitForFunction(() => window.__nightShiftVisual?.ready === true, { timeout: 30000 });

  const bootState = await page.evaluate(() => ({
    hasVisualHarness: window.__nightShiftVisual?.ready === true,
    bootHidden: document.getElementById('boot')?.classList.contains('hidden') ?? false,
    canvasCount: document.querySelectorAll('canvas').length,
    bodyClass: document.body.className,
  }));

  for (const camera of cameras) {
    const applied = await page.evaluate((fixture) => window.__nightShiftVisual.setCamera(fixture), camera);
    const path = join(TMP, `${camera.name}.png`);
    await page.screenshot({ path });
    console.log(`captured ${camera.name}`, applied);
  }

  const compareReport = compareDirectories({
    actualDir: TMP,
    baselineDir: BASELINES,
    update: options.update,
    threshold: options.threshold,
    maeThreshold: options.maeThreshold,
    pixelThreshold: options.pixelThreshold,
  });

  const report = {
    ok: errors.length === 0 && bootState.hasVisualHarness && bootState.canvasCount > 0 && compareReport.ok,
    update: options.update,
    bootState,
    errors,
    logs: logs.slice(-60),
    compare: compareReport,
  };
  writeFileSync(join(TMP, 'visual-regression-report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  process.exitCode = report.ok ? 0 : 1;
} finally {
  if (browser) await browser.close();
  server.close();
}
