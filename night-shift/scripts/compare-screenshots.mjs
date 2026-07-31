import { existsSync, mkdirSync, readdirSync, readFileSync, copyFileSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { inflateSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';

const PNG_SIGNATURE = '89504e470d0a1a0a';
const DEFAULT_PIXEL_THRESHOLD = 24;
const DEFAULT_DIFF_THRESHOLD = 0.02;

function readUInt32(buffer, offset) {
  return buffer.readUInt32BE(offset);
}

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

export function decodePng(path) {
  const buffer = readFileSync(path);
  if (buffer.subarray(0, 8).toString('hex') !== PNG_SIGNATURE) {
    throw new Error(`${path} is not a PNG`);
  }

  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let interlace = 0;
  const idat = [];

  while (offset < buffer.length) {
    const length = readUInt32(buffer, offset);
    const type = buffer.subarray(offset + 4, offset + 8).toString('ascii');
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    const data = buffer.subarray(dataStart, dataEnd);

    if (type === 'IHDR') {
      width = readUInt32(data, 0);
      height = readUInt32(data, 4);
      bitDepth = data[8];
      colorType = data[9];
      interlace = data[12];
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') {
      break;
    }

    offset = dataEnd + 4;
  }

  if (bitDepth !== 8 || interlace !== 0) {
    throw new Error(`${path} uses unsupported PNG format: bitDepth=${bitDepth}, interlace=${interlace}`);
  }

  const channelsByType = {
    0: 1,
    2: 3,
    4: 2,
    6: 4,
  };
  const channels = channelsByType[colorType];
  if (!channels) throw new Error(`${path} uses unsupported PNG color type ${colorType}`);

  const bpp = channels;
  const stride = width * bpp;
  const raw = inflateSync(Buffer.concat(idat));
  const pixels = new Uint8Array(width * height * 4);
  let src = 0;
  let dst = 0;
  let prev = new Uint8Array(stride);
  let row = new Uint8Array(stride);

  for (let y = 0; y < height; y++) {
    const filter = raw[src++];
    const encoded = raw.subarray(src, src + stride);
    src += stride;

    for (let x = 0; x < stride; x++) {
      const left = x >= bpp ? row[x - bpp] : 0;
      const up = prev[x] ?? 0;
      const upLeft = x >= bpp ? prev[x - bpp] : 0;
      let value = encoded[x];

      if (filter === 1) value += left;
      else if (filter === 2) value += up;
      else if (filter === 3) value += Math.floor((left + up) / 2);
      else if (filter === 4) value += paeth(left, up, upLeft);
      else if (filter !== 0) throw new Error(`${path} has unsupported PNG filter ${filter}`);

      row[x] = value & 0xff;
    }

    for (let x = 0; x < width; x++) {
      const i = x * channels;
      if (colorType === 0) {
        pixels[dst++] = row[i];
        pixels[dst++] = row[i];
        pixels[dst++] = row[i];
        pixels[dst++] = 255;
      } else if (colorType === 2) {
        pixels[dst++] = row[i];
        pixels[dst++] = row[i + 1];
        pixels[dst++] = row[i + 2];
        pixels[dst++] = 255;
      } else if (colorType === 4) {
        pixels[dst++] = row[i];
        pixels[dst++] = row[i];
        pixels[dst++] = row[i];
        pixels[dst++] = row[i + 1];
      } else {
        pixels[dst++] = row[i];
        pixels[dst++] = row[i + 1];
        pixels[dst++] = row[i + 2];
        pixels[dst++] = row[i + 3];
      }
    }

    const swap = prev;
    prev = row;
    row = swap;
  }

  return { width, height, pixels };
}

export function comparePngs(actualPath, baselinePath, options = {}) {
  const pixelThreshold = options.pixelThreshold ?? DEFAULT_PIXEL_THRESHOLD;
  const actual = decodePng(actualPath);
  const baseline = decodePng(baselinePath);

  if (actual.width !== baseline.width || actual.height !== baseline.height) {
    return {
      actualPath,
      baselinePath,
      ok: false,
      reason: 'dimension-mismatch',
      actualSize: [actual.width, actual.height],
      baselineSize: [baseline.width, baseline.height],
    };
  }

  let diffPixels = 0;
  let totalAbs = 0;
  const totalPixels = actual.width * actual.height;

  for (let i = 0; i < actual.pixels.length; i += 4) {
    const dr = Math.abs(actual.pixels[i] - baseline.pixels[i]);
    const dg = Math.abs(actual.pixels[i + 1] - baseline.pixels[i + 1]);
    const db = Math.abs(actual.pixels[i + 2] - baseline.pixels[i + 2]);
    const maxDelta = Math.max(dr, dg, db);
    totalAbs += dr + dg + db;
    if (maxDelta > pixelThreshold) diffPixels++;
  }

  const diffRatio = diffPixels / totalPixels;
  const mae = totalAbs / (totalPixels * 255 * 3);
  const threshold = options.threshold ?? DEFAULT_DIFF_THRESHOLD;
  const maeThreshold = options.maeThreshold ?? threshold;

  return {
    actualPath,
    baselinePath,
    ok: diffRatio <= threshold && mae <= maeThreshold,
    width: actual.width,
    height: actual.height,
    diffPixels,
    totalPixels,
    diffRatio,
    mae,
    threshold,
    maeThreshold,
    pixelThreshold,
  };
}

export function compareDirectories(options = {}) {
  const actualDir = resolve(options.actualDir ?? 'tests/visual/__tmp__');
  const baselineDir = resolve(options.baselineDir ?? 'tests/visual/baselines');
  const update = Boolean(options.update);
  const threshold = options.threshold ?? DEFAULT_DIFF_THRESHOLD;
  const maeThreshold = options.maeThreshold ?? threshold;
  const pixelThreshold = options.pixelThreshold ?? DEFAULT_PIXEL_THRESHOLD;

  mkdirSync(baselineDir, { recursive: true });
  const actualFiles = readdirSync(actualDir)
    .filter((file) => file.endsWith('.png'))
    .sort();

  const results = [];
  for (const file of actualFiles) {
    const actualPath = join(actualDir, file);
    const baselinePath = join(baselineDir, file);
    if (update) {
      copyFileSync(actualPath, baselinePath);
      results.push({
        actualPath,
        baselinePath,
        ok: true,
        updated: true,
      });
      continue;
    }

    if (!existsSync(baselinePath)) {
      results.push({
        actualPath,
        baselinePath,
        ok: false,
        reason: 'missing-baseline',
      });
      continue;
    }

    results.push(comparePngs(actualPath, baselinePath, { threshold, maeThreshold, pixelThreshold }));
  }

  const missing = readdirSync(baselineDir)
    .filter((file) => file.endsWith('.png') && !actualFiles.includes(file))
    .sort()
    .map((file) => ({
      baselinePath: join(baselineDir, file),
      ok: false,
      reason: 'missing-actual',
    }));

  results.push(...missing);

  const report = {
    ok: results.every((result) => result.ok),
    update,
    actualDir,
    baselineDir,
    results,
  };

  writeFileSync(join(actualDir, 'visual-compare-report.json'), JSON.stringify(report, null, 2));
  return report;
}

function parseCli(argv) {
  const options = {};
  for (const arg of argv) {
    if (arg === '--update') options.update = true;
    else if (arg.startsWith('--actual=')) options.actualDir = arg.slice('--actual='.length);
    else if (arg.startsWith('--baseline=')) options.baselineDir = arg.slice('--baseline='.length);
    else if (arg.startsWith('--threshold=')) options.threshold = Number(arg.slice('--threshold='.length));
    else if (arg.startsWith('--mae-threshold=')) options.maeThreshold = Number(arg.slice('--mae-threshold='.length));
    else if (arg.startsWith('--pixel-threshold=')) options.pixelThreshold = Number(arg.slice('--pixel-threshold='.length));
  }
  return options;
}

const isCli = basename(fileURLToPath(import.meta.url)) === basename(process.argv[1] ?? '');
if (isCli) {
  const report = compareDirectories(parseCli(process.argv.slice(2)));
  console.log(JSON.stringify(report, null, 2));
  process.exit(report.ok ? 0 : 1);
}
