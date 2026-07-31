import * as THREE from 'three';

const textureCache = new Map();

const srgb = THREE.SRGBColorSpace;
const linear = THREE.NoColorSpace;

function hash2(x, y, seed) {
  const n = Math.sin(x * 127.1 + y * 311.7 + seed * 74.7) * 43758.5453123;
  return n - Math.floor(n);
}

function fbm(x, y, seed) {
  let value = 0;
  let amp = 0.5;
  let freq = 1;

  for (let i = 0; i < 4; i++) {
    value += hash2(Math.floor(x * freq), Math.floor(y * freq), seed + i * 13.37) * amp;
    freq *= 2.03;
    amp *= 0.5;
  }

  return value;
}

function ridge(value) {
  return 1 - Math.abs(value * 2 - 1);
}

function smoothstep(edge0, edge1, x) {
  const t = THREE.MathUtils.clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

function fract(value) {
  return value - Math.floor(value);
}

function wrapPixel(value, size) {
  return ((Math.floor(value) % size) + size) % size;
}

function colorToCss(color) {
  const c = new THREE.Color(color);
  return `rgb(${Math.round(c.r * 255)}, ${Math.round(c.g * 255)}, ${Math.round(c.b * 255)})`;
}

function normalizePanel(panel = [4, 3]) {
  return [
    Math.max(1, panel[0] ?? 4),
    Math.max(1, panel[1] ?? 3),
  ];
}

function normalScale(value, fallback) {
  if (value?.isVector2) return value.clone();
  if (Array.isArray(value)) return new THREE.Vector2(value[0] ?? fallback, value[1] ?? fallback);
  if (typeof value === 'number') return new THREE.Vector2(value, value);
  return new THREE.Vector2(fallback, fallback);
}

function tagSurface(material, surface) {
  material.userData.surface = surface;
  return material;
}

function stencilMask(x, y, size, seed) {
  const u = x / size;
  const v = y / size;
  const label = u > 0.11 && u < 0.48 && v > 0.14 && v < 0.27;
  const idPlate = u > 0.62 && u < 0.91 && v > 0.68 && v < 0.8;
  const warningBar = u > 0.08 && u < 0.92 && v > 0.83 && v < 0.88;
  const arrow = u > 0.58 && u < 0.88 && v > 0.18 && v < 0.36 &&
    Math.abs((v - 0.27) - (u - 0.73) * 0.34) < 0.035;
  const chipped = hash2(x, y, seed + 211) > 0.22 && fbm(x / 5, y / 5, seed + 217) > 0.34;

  if (!chipped) return 0;
  if (label) {
    const letterBars = (Math.floor((u - 0.11) * size / 5) + Math.floor((v - 0.14) * size / 7)) % 4 !== 0;
    return letterBars ? 0.55 : 0.18;
  }
  if (idPlate) return (Math.floor((u - 0.62) * size / 9) % 2 === 0 || Math.floor((v - 0.68) * size / 6) % 2 === 0) ? 0.44 : 0;
  if (warningBar) return Math.floor(u * 34 + v * 12) % 3 === 0 ? 0.48 : 0.16;
  if (arrow) return 0.36;
  return 0;
}

function detailSample(x, y, options) {
  const { size, seed, seams, panel, seamWidth, stencils, cableGrime, edgeWearStrength } = options;
  const px = wrapPixel(x, size);
  const py = wrapPixel(y, size);
  const u = px / size;
  const v = py / size;
  const [cols, rows] = normalizePanel(panel);
  const fine = hash2(px, py, seed) - 0.5;
  const cloud = fbm(px / 18, py / 18, seed) - 0.5;
  const stain = fbm(px / 44 + seed * 0.03, py / 29 - seed * 0.05, seed + 71) - 0.5;
  const verticalRun = Math.pow(ridge(hash2(Math.floor(px / 9), seed, seed + 19)), 4) *
    Math.max(0, 1 - v);
  const scratch =
    (hash2(Math.floor(px / 2), Math.floor((py + seed * 29) / 34), seed) > 0.88 ? 1 : 0) *
    (hash2(px, py, seed + 9) - 0.25);
  const edgeWear = Math.max(
    smoothstep(0.085, 0.0, u),
    smoothstep(0.085, 0.0, v),
    smoothstep(0.085, 0.0, 1 - u),
    smoothstep(0.085, 0.0, 1 - v)
  ) * edgeWearStrength;
  const seamU = Math.min(fract(u * cols), 1 - fract(u * cols));
  const seamV = Math.min(fract(v * rows), 1 - fract(v * rows));
  const seam = seams
    ? Math.max(
      smoothstep((seamWidth ?? 0.018) * cols, 0.0, seamU),
      smoothstep((seamWidth ?? 0.018) * rows, 0.0, seamV)
    )
    : 0;
  const panelDirt = seams
    ? (hash2(Math.floor(u * cols), Math.floor(v * rows), seed + 31) - 0.5) * 0.35
    : 0;
  const stencil = stencils ? stencilMask(px, py, size, seed) : 0;
  const cableStripe = cableGrime
    ? Math.pow(ridge(fract((px + seed * 3.1) / 17 + fbm(px / 33, py / 24, seed + 137) * 0.45)), 3) *
      (0.35 + Math.max(0, stain) * 1.3)
    : 0;
  const cableDust = cableGrime
    ? Math.max(0, fbm(px / 12, py / 7, seed + 149) - 0.45) * 1.4
    : 0;
  const grime = Math.max(0, stain * 1.9 + verticalRun * 0.55 + seam * 0.38 + cableStripe * 0.72 + cableDust);

  return {
    fine,
    cloud,
    stain,
    verticalRun,
    scratch,
    edgeWear,
    seam,
    panelDirt,
    stencil,
    cableStripe,
    cableDust,
    grime,
  };
}

function heightSample(x, y, options) {
  const d = detailSample(x, y, options);
  const px = wrapPixel(x, options.size);
  const py = wrapPixel(y, options.size);
  return THREE.MathUtils.clamp(
    0.5 +
    ridge(fbm(px / 9, py / 9, options.seed + 121)) * 0.18 +
    d.fine * 0.08 +
    d.scratch * 0.28 +
    d.edgeWear * 0.13 +
    d.stencil * 0.045 -
    d.grime * 0.16 -
    d.seam * 0.34,
    0,
    1
  );
}

function drawCanvasStencils(ctx, size, seed, labelColor) {
  ctx.save();
  ctx.globalAlpha = 0.36;
  ctx.fillStyle = colorToCss(labelColor);
  ctx.strokeStyle = colorToCss(labelColor);
  ctx.lineWidth = Math.max(1, size * 0.008);
  ctx.font = `700 ${Math.floor(size * 0.072)}px monospace`;
  ctx.translate(size * 0.1, size * 0.24);
  ctx.rotate(-0.035);
  ctx.fillText('NO EXIT', 0, 0);
  ctx.font = `700 ${Math.floor(size * 0.045)}px monospace`;
  ctx.fillText('SECTOR 12', size * 0.51, size * 0.49);
  ctx.strokeRect(size * 0.5, size * 0.39, size * 0.27, size * 0.12);
  ctx.fillRect(size * -0.02, size * 0.59, size * 0.78, Math.max(2, size * 0.018));
  ctx.beginPath();
  ctx.moveTo(size * 0.56, size * -0.02);
  ctx.lineTo(size * 0.75, size * 0.07);
  ctx.lineTo(size * 0.56, size * 0.16);
  ctx.stroke();

  ctx.globalCompositeOperation = 'destination-out';
  ctx.globalAlpha = 0.28;
  for (let i = 0; i < size * 0.9; i++) {
    const x = hash2(i, seed, seed + 3) * size;
    const y = hash2(seed, i, seed + 5) * size;
    const w = 1 + hash2(i, seed, seed + 7) * size * 0.018;
    const h = 1 + hash2(seed, i, seed + 11) * size * 0.012;
    ctx.fillRect(x, y, w, h);
  }
  ctx.restore();
}

function makeTexture({
  key,
  size = 128,
  color = 0x20242a,
  variation = 0.18,
  roughness = false,
  kind = roughness ? 'roughness' : 'albedo',
  repeat = [4, 4],
  seed = 1,
  seams = false,
  panel = [4, 3],
  seamWidth = 0.018,
  stencils = false,
  labelColor = 0xd4832b,
  cableGrime = false,
  edgeWearStrength = 1,
  normalIntensity = 3.2,
} = {}) {
  const cacheKey = JSON.stringify({
    key,
    size,
    color,
    variation,
    roughness,
    kind,
    repeat,
    seed,
    seams,
    panel,
    seamWidth,
    stencils,
    labelColor,
    cableGrime,
    edgeWearStrength,
    normalIntensity,
  });
  if (textureCache.has(cacheKey)) return textureCache.get(cacheKey);

  const base = new THREE.Color(color);
  const greenBlack = new THREE.Color(0x0e1712);
  const wear = new THREE.Color(0x8a8f86);
  const sodiumStencil = new THREE.Color(labelColor);
  const sampleOptions = { size, seed, seams, panel, seamWidth, stencils, cableGrime, edgeWearStrength };
  const writePixel = (data, i, x, y) => {
    const detail = detailSample(x, y, sampleOptions);
    const n =
      detail.fine * 0.5 +
      detail.cloud * 0.9 +
      detail.scratch * 0.72 -
      detail.grime * 0.48 +
      detail.edgeWear * 0.31 -
      detail.seam * 0.32 +
      detail.panelDirt;

    if (kind === 'roughness') {
      const v = Math.round(THREE.MathUtils.clamp(
        188 + detail.cloud * 86 + detail.grime * 58 + detail.seam * 36 - detail.edgeWear * 42,
        82,
        252
      ));
      data[i] = v;
      data[i + 1] = v;
      data[i + 2] = v;
    } else if (kind === 'bump') {
      const v = Math.round(THREE.MathUtils.clamp(heightSample(x, y, sampleOptions) * 255, 36, 230));
      data[i] = v;
      data[i + 1] = v;
      data[i + 2] = v;
    } else if (kind === 'normal') {
      const left = heightSample(x - 1, y, sampleOptions);
      const right = heightSample(x + 1, y, sampleOptions);
      const up = heightSample(x, y - 1, sampleOptions);
      const down = heightSample(x, y + 1, sampleOptions);
      const nx = (left - right) * normalIntensity;
      const ny = (up - down) * normalIntensity;
      const nz = 1;
      const invLength = 1 / Math.hypot(nx, ny, nz);
      data[i] = Math.round((nx * invLength * 0.5 + 0.5) * 255);
      data[i + 1] = Math.round((ny * invLength * 0.5 + 0.5) * 255);
      data[i + 2] = Math.round((nz * invLength * 0.5 + 0.5) * 255);
    } else if (kind === 'ao') {
      const v = Math.round(THREE.MathUtils.clamp(
        228 - detail.grime * 94 - detail.verticalRun * 38 - detail.edgeWear * 44 - detail.seam * 58,
        102,
        248
      ));
      data[i] = v;
      data[i + 1] = v;
      data[i + 2] = v;
    } else {
      const mul = 1 + n * variation;
      const aoDarken = THREE.MathUtils.clamp(detail.grime * 0.42 + detail.seam * 0.24 + detail.verticalRun * 0.12, 0, 0.62);
      const grimeBlend = THREE.MathUtils.clamp(detail.grime * 0.42 + detail.cableStripe * 0.28, 0, 0.66);
      let r = THREE.MathUtils.lerp(base.r * mul * (1 - aoDarken), greenBlack.r, grimeBlend);
      let g = THREE.MathUtils.lerp(base.g * mul * (1 - aoDarken), greenBlack.g, grimeBlend);
      let b = THREE.MathUtils.lerp(base.b * mul * (1 - aoDarken), greenBlack.b, grimeBlend);
      const wearAmount = THREE.MathUtils.clamp(detail.edgeWear * 0.23 + detail.scratch * 0.16, 0, 0.32);
      r = THREE.MathUtils.lerp(r, wear.r, wearAmount);
      g = THREE.MathUtils.lerp(g, wear.g, wearAmount);
      b = THREE.MathUtils.lerp(b, wear.b, wearAmount);
      if (detail.stencil > 0) {
        const stencilAlpha = THREE.MathUtils.clamp(detail.stencil * 0.72, 0, 0.42);
        r = THREE.MathUtils.lerp(r, sodiumStencil.r, stencilAlpha);
        g = THREE.MathUtils.lerp(g, sodiumStencil.g, stencilAlpha);
        b = THREE.MathUtils.lerp(b, sodiumStencil.b, stencilAlpha);
      }
      data[i] = Math.round(THREE.MathUtils.clamp(r * 255, 0, 255));
      data[i + 1] = Math.round(THREE.MathUtils.clamp(g * 255, 0, 255));
      data[i + 2] = Math.round(THREE.MathUtils.clamp(b * 255, 0, 255));
    }
    data[i + 3] = 255;
  };
  let texture;

  if (typeof document !== 'undefined') {
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    const img = ctx.createImageData(size, size);

    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const i = (y * size + x) * 4;
        writePixel(img.data, i, x, y);
      }
    }

    ctx.putImageData(img, 0, 0);
    if (kind === 'albedo' && stencils) drawCanvasStencils(ctx, size, seed, labelColor);
    texture = new THREE.CanvasTexture(canvas);
  } else {
    const data = new Uint8Array(size * size * 4);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const i = (y * size + x) * 4;
        writePixel(data, i, x, y);
      }
    }
    texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
    texture.needsUpdate = true;
  }

  texture.name = key;
  texture.colorSpace = kind === 'albedo' ? srgb : linear;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(repeat[0], repeat[1]);
  texture.anisotropy = 4;

  textureCache.set(cacheKey, texture);
  return texture;
}

export function concrete(options = {}) {
  const color = options.color ?? 0x24292d;
  return tagSurface(new THREE.MeshStandardMaterial({
    name: options.name ?? 'cold scuffed concrete',
    color,
    map: makeTexture({
      key: `${options.name ?? 'concrete'}-albedo`,
      color,
      variation: options.variation ?? 0.2,
      repeat: options.repeat ?? [7, 6],
      seed: options.seed ?? 3,
      seams: options.seams ?? true,
      panel: options.panel ?? [5, 4],
      seamWidth: options.seamWidth ?? 0.011,
      stencils: options.stencils ?? false,
      labelColor: options.labelColor ?? 0xc77924,
      cableGrime: options.cableGrime ?? false,
      edgeWearStrength: options.edgeWearStrength ?? 1.05,
    }),
    roughnessMap: makeTexture({
      key: `${options.name ?? 'concrete'}-roughness`,
      kind: 'roughness',
      repeat: options.repeat ?? [7, 6],
      seed: (options.seed ?? 3) + 41,
      seams: options.seams ?? true,
      panel: options.panel ?? [5, 4],
      seamWidth: options.seamWidth ?? 0.011,
      cableGrime: options.cableGrime ?? false,
      edgeWearStrength: options.edgeWearStrength ?? 1.05,
    }),
    normalMap: makeTexture({
      key: `${options.name ?? 'concrete'}-normal-from-bump`,
      kind: 'normal',
      repeat: options.repeat ?? [7, 6],
      seed: (options.seed ?? 3) + 83,
      seams: options.seams ?? true,
      panel: options.panel ?? [5, 4],
      seamWidth: options.seamWidth ?? 0.011,
      stencils: options.stencils ?? false,
      cableGrime: options.cableGrime ?? false,
      edgeWearStrength: options.edgeWearStrength ?? 1.05,
      normalIntensity: options.normalIntensity ?? 3.6,
    }),
    normalScale: normalScale(options.normalScale, options.normalScaleDefault ?? 0.62),
    aoMap: makeTexture({
      key: `${options.name ?? 'concrete'}-ao`,
      kind: 'ao',
      repeat: options.repeat ?? [7, 6],
      seed: (options.seed ?? 3) + 127,
      seams: options.seams ?? true,
      panel: options.panel ?? [5, 4],
      seamWidth: options.seamWidth ?? 0.011,
      cableGrime: options.cableGrime ?? false,
      edgeWearStrength: options.edgeWearStrength ?? 1.05,
    }),
    aoMapIntensity: options.aoMapIntensity ?? 0.42,
    metalness: options.metalness ?? 0.035,
    roughness: options.roughness ?? 0.88,
    envMapIntensity: options.envMapIntensity ?? 0.16,
  }), 'concrete');
}

export function metal(options = {}) {
  const color = options.color ?? 0x4b5559;
  return tagSurface(new THREE.MeshStandardMaterial({
    name: options.name ?? 'oxidized steel',
    color,
    map: makeTexture({
      key: `${options.name ?? 'metal'}-albedo`,
      color,
      variation: options.variation ?? 0.14,
      repeat: options.repeat ?? [3, 3],
      seed: options.seed ?? 9,
      seams: options.seams ?? true,
      panel: options.panel ?? [3, 4],
      seamWidth: options.seamWidth ?? 0.015,
      stencils: options.stencils ?? false,
      labelColor: options.labelColor ?? 0xd98a2a,
      cableGrime: options.cableGrime ?? false,
      edgeWearStrength: options.edgeWearStrength ?? 1.22,
    }),
    roughnessMap: makeTexture({
      key: `${options.name ?? 'metal'}-roughness`,
      kind: 'roughness',
      repeat: options.repeat ?? [3, 3],
      seed: (options.seed ?? 9) + 17,
      seams: options.seams ?? true,
      panel: options.panel ?? [3, 4],
      seamWidth: options.seamWidth ?? 0.015,
      cableGrime: options.cableGrime ?? false,
      edgeWearStrength: options.edgeWearStrength ?? 1.22,
    }),
    normalMap: makeTexture({
      key: `${options.name ?? 'metal'}-normal-from-bump`,
      kind: 'normal',
      repeat: options.repeat ?? [3, 3],
      seed: (options.seed ?? 9) + 53,
      seams: options.seams ?? true,
      panel: options.panel ?? [3, 4],
      seamWidth: options.seamWidth ?? 0.015,
      stencils: options.stencils ?? false,
      cableGrime: options.cableGrime ?? false,
      edgeWearStrength: options.edgeWearStrength ?? 1.22,
      normalIntensity: options.normalIntensity ?? 4.2,
    }),
    normalScale: normalScale(options.normalScale, options.normalScaleDefault ?? 0.36),
    aoMap: makeTexture({
      key: `${options.name ?? 'metal'}-ao`,
      kind: 'ao',
      repeat: options.repeat ?? [3, 3],
      seed: (options.seed ?? 9) + 89,
      seams: options.seams ?? true,
      panel: options.panel ?? [3, 4],
      seamWidth: options.seamWidth ?? 0.015,
      cableGrime: options.cableGrime ?? false,
      edgeWearStrength: options.edgeWearStrength ?? 1.22,
    }),
    aoMapIntensity: options.aoMapIntensity ?? 0.32,
    metalness: options.metalness ?? 0.78,
    roughness: options.roughness ?? 0.53,
    envMapIntensity: options.envMapIntensity ?? 0.46,
  }), 'metal');
}

export function paintedMetal(options = {}) {
  const color = options.color ?? 0x303840;
  return tagSurface(new THREE.MeshStandardMaterial({
    name: options.name ?? 'worn painted metal',
    color,
    map: makeTexture({
      key: `${options.name ?? 'painted-metal'}-albedo`,
      color,
      variation: options.variation ?? 0.18,
      repeat: options.repeat ?? [4, 3],
      seed: options.seed ?? 14,
      seams: options.seams ?? true,
      panel: options.panel ?? [4, 3],
      seamWidth: options.seamWidth ?? 0.016,
      stencils: options.stencils ?? false,
      labelColor: options.labelColor ?? 0xd4832b,
      cableGrime: options.cableGrime ?? false,
      edgeWearStrength: options.edgeWearStrength ?? 1.16,
    }),
    roughnessMap: makeTexture({
      key: `${options.name ?? 'painted-metal'}-roughness`,
      kind: 'roughness',
      repeat: options.repeat ?? [4, 3],
      seed: (options.seed ?? 14) + 23,
      seams: options.seams ?? true,
      panel: options.panel ?? [4, 3],
      seamWidth: options.seamWidth ?? 0.016,
      cableGrime: options.cableGrime ?? false,
      edgeWearStrength: options.edgeWearStrength ?? 1.16,
    }),
    normalMap: makeTexture({
      key: `${options.name ?? 'painted-metal'}-normal-from-bump`,
      kind: 'normal',
      repeat: options.repeat ?? [4, 3],
      seed: (options.seed ?? 14) + 61,
      seams: options.seams ?? true,
      panel: options.panel ?? [4, 3],
      seamWidth: options.seamWidth ?? 0.016,
      stencils: options.stencils ?? false,
      cableGrime: options.cableGrime ?? false,
      edgeWearStrength: options.edgeWearStrength ?? 1.16,
      normalIntensity: options.normalIntensity ?? 3.9,
    }),
    normalScale: normalScale(options.normalScale, options.normalScaleDefault ?? 0.46),
    aoMap: makeTexture({
      key: `${options.name ?? 'painted-metal'}-ao`,
      kind: 'ao',
      repeat: options.repeat ?? [4, 3],
      seed: (options.seed ?? 14) + 97,
      seams: options.seams ?? true,
      panel: options.panel ?? [4, 3],
      seamWidth: options.seamWidth ?? 0.016,
      cableGrime: options.cableGrime ?? false,
      edgeWearStrength: options.edgeWearStrength ?? 1.16,
    }),
    aoMapIntensity: options.aoMapIntensity ?? 0.36,
    metalness: options.metalness ?? 0.38,
    roughness: options.roughness ?? 0.68,
    envMapIntensity: options.envMapIntensity ?? 0.28,
  }), options.surface ?? 'metal');
}

export function glass(options = {}) {
  return tagSurface(new THREE.MeshPhysicalMaterial({
    name: options.name ?? 'smoked security glass',
    color: options.color ?? 0x6e8d92,
    metalness: 0,
    roughness: options.roughness ?? 0.22,
    transmission: options.transmission ?? 0.22,
    thickness: options.thickness ?? 0.08,
    transparent: true,
    opacity: options.opacity ?? 0.34,
    clearcoat: 0.35,
    clearcoatRoughness: 0.5,
    envMapIntensity: options.envMapIntensity ?? 0.5,
  }), 'glass');
}

export function emissiveTrim(options = {}) {
  const color = new THREE.Color(options.color ?? 0xff9b38);
  return tagSurface(new THREE.MeshStandardMaterial({
    name: options.name ?? 'muted emissive trim',
    color: options.baseColor ?? color.clone().multiplyScalar(0.45),
    emissive: color,
    emissiveIntensity: options.intensity ?? 0.65,
    metalness: options.metalness ?? 0.2,
    roughness: options.roughness ?? 0.5,
    envMapIntensity: options.envMapIntensity ?? 0.16,
  }), options.surface ?? 'metal');
}

export function fabric(options = {}) {
  const color = options.color ?? 0x262b27;
  return tagSurface(new THREE.MeshStandardMaterial({
    name: options.name ?? 'stained utility fabric',
    color,
    map: makeTexture({
      key: `${options.name ?? 'fabric'}-albedo`,
      color,
      variation: options.variation ?? 0.16,
      repeat: options.repeat ?? [3, 3],
      seed: options.seed ?? 22,
      seams: options.seams ?? false,
      panel: options.panel ?? [3, 3],
      stencils: options.stencils ?? false,
      cableGrime: options.cableGrime ?? false,
      edgeWearStrength: options.edgeWearStrength ?? 0.72,
    }),
    roughnessMap: makeTexture({
      key: `${options.name ?? 'fabric'}-roughness`,
      kind: 'roughness',
      repeat: options.repeat ?? [3, 3],
      seed: (options.seed ?? 22) + 23,
      seams: options.seams ?? false,
      panel: options.panel ?? [3, 3],
      edgeWearStrength: options.edgeWearStrength ?? 0.72,
    }),
    normalMap: makeTexture({
      key: `${options.name ?? 'fabric'}-normal-from-bump`,
      kind: 'normal',
      repeat: options.repeat ?? [3, 3],
      seed: (options.seed ?? 22) + 61,
      seams: options.seams ?? false,
      panel: options.panel ?? [3, 3],
      normalIntensity: options.normalIntensity ?? 2.2,
      edgeWearStrength: options.edgeWearStrength ?? 0.72,
    }),
    normalScale: normalScale(options.normalScale, options.normalScaleDefault ?? 0.28),
    aoMap: makeTexture({
      key: `${options.name ?? 'fabric'}-ao`,
      kind: 'ao',
      repeat: options.repeat ?? [3, 3],
      seed: (options.seed ?? 22) + 97,
      seams: options.seams ?? false,
      panel: options.panel ?? [3, 3],
      edgeWearStrength: options.edgeWearStrength ?? 0.72,
    }),
    aoMapIntensity: options.aoMapIntensity ?? 0.28,
    metalness: 0,
    roughness: options.roughness ?? 0.92,
    envMapIntensity: options.envMapIntensity ?? 0.08,
  }), 'fabric');
}

export function applyEnvironmentMap(root, envMap, { intensity = 0.35 } = {}) {
  root.traverse((obj) => {
    if (!obj.isMesh) return;
    const materials = Array.isArray(obj.material) ? obj.material : [obj.material];
    for (const mat of materials) {
      if (!mat || (!mat.isMeshStandardMaterial && !mat.isMeshPhysicalMaterial)) continue;
      mat.envMap = envMap;
      mat.envMapIntensity = obj.userData.reflectiveFloor
        ? Math.max(mat.envMapIntensity ?? 0, 0.58)
        : Math.max(mat.envMapIntensity ?? 0, intensity);
      mat.needsUpdate = true;
    }
  });
}

export function captureEnvironmentMap(renderer, scene, position = new THREE.Vector3(0, 1.2, 0), options = {}) {
  const size = options.size ?? 128;
  const cubeTarget = new THREE.WebGLCubeRenderTarget(size, {
    type: THREE.HalfFloatType,
    generateMipmaps: true,
    minFilter: THREE.LinearMipmapLinearFilter,
  });
  const cubeCamera = new THREE.CubeCamera(options.near ?? 0.1, options.far ?? 60, cubeTarget);
  cubeCamera.position.copy(position);

  const hidden = [];
  scene.traverse((obj) => {
    if (obj.userData?.reflectiveFloor) {
      hidden.push([obj, obj.visible]);
      obj.visible = false;
    }
  });

  scene.add(cubeCamera);
  cubeCamera.update(renderer, scene);
  scene.remove(cubeCamera);

  for (const [obj, visible] of hidden) obj.visible = visible;

  const pmrem = new THREE.PMREMGenerator(renderer);
  const pmremTarget = pmrem.fromCubemap(cubeTarget.texture);
  pmrem.dispose();
  cubeTarget.dispose();

  return {
    texture: pmremTarget.texture,
    dispose: () => pmremTarget.dispose(),
  };
}

export const Materials = {
  concrete,
  metal,
  paintedMetal,
  glass,
  emissiveTrim,
  fabric,
  applyEnvironmentMap,
  captureEnvironmentMap,
};
