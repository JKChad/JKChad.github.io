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

function makeTexture({
  key,
  size = 128,
  color = 0x20242a,
  variation = 0.18,
  roughness = false,
  kind = roughness ? 'roughness' : 'albedo',
  repeat = [4, 4],
  seed = 1,
} = {}) {
  const cacheKey = JSON.stringify({ key, size, color, variation, roughness, kind, repeat, seed });
  if (textureCache.has(cacheKey)) return textureCache.get(cacheKey);

  const base = new THREE.Color(color);
  const greenBlack = new THREE.Color(0x0e1712);
  const wear = new THREE.Color(0x8a8f86);
  const writePixel = (data, i, x, y) => {
    const fine = hash2(x, y, seed) - 0.5;
    const cloud = fbm(x / 18, y / 18, seed) - 0.5;
    const stain = fbm(x / 44 + seed * 0.03, y / 29 - seed * 0.05, seed + 71) - 0.5;
    const verticalRun = Math.pow(ridge(hash2(Math.floor(x / 9), seed, seed + 19)), 4) *
      Math.max(0, 1 - y / size);
    const scratch =
      (hash2(Math.floor(x / 2), Math.floor((y + seed * 29) / 34), seed) > 0.88 ? 1 : 0) *
      (hash2(x, y, seed + 9) - 0.25);
    const edgeWear = Math.max(
      smoothstep(0.085, 0.0, x / size),
      smoothstep(0.085, 0.0, y / size),
      smoothstep(0.085, 0.0, 1 - x / size),
      smoothstep(0.085, 0.0, 1 - y / size)
    );
    const grime = Math.max(0, stain * 1.9 + verticalRun * 0.55);
    const n = fine * 0.5 + cloud * 0.9 + scratch * 0.72 - grime * 0.42 + edgeWear * 0.28;

    if (kind === 'roughness') {
      const v = Math.round(THREE.MathUtils.clamp(188 + cloud * 86 + grime * 52 - edgeWear * 38, 82, 252));
      data[i] = v;
      data[i + 1] = v;
      data[i + 2] = v;
    } else if (kind === 'bump') {
      const gouge = scratch * 0.9 - grime * 0.45 + ridge(fbm(x / 9, y / 9, seed + 121)) * 0.35;
      const v = Math.round(THREE.MathUtils.clamp(126 + gouge * 88 + fine * 30, 44, 218));
      data[i] = v;
      data[i + 1] = v;
      data[i + 2] = v;
    } else if (kind === 'ao') {
      const v = Math.round(THREE.MathUtils.clamp(224 - grime * 82 - verticalRun * 36 - edgeWear * 42, 118, 248));
      data[i] = v;
      data[i + 1] = v;
      data[i + 2] = v;
    } else {
      const mul = 1 + n * variation;
      const r = THREE.MathUtils.lerp(base.r * mul, greenBlack.r, THREE.MathUtils.clamp(grime * 0.36, 0, 0.5));
      const g = THREE.MathUtils.lerp(base.g * mul, greenBlack.g, THREE.MathUtils.clamp(grime * 0.3, 0, 0.45));
      const b = THREE.MathUtils.lerp(base.b * mul, greenBlack.b, THREE.MathUtils.clamp(grime * 0.4, 0, 0.52));
      const wearAmount = THREE.MathUtils.clamp(edgeWear * 0.2 + scratch * 0.14, 0, 0.28);
      data[i] = Math.round(THREE.MathUtils.clamp(THREE.MathUtils.lerp(r, wear.r, wearAmount) * 255, 0, 255));
      data[i + 1] = Math.round(THREE.MathUtils.clamp(THREE.MathUtils.lerp(g, wear.g, wearAmount) * 255, 0, 255));
      data[i + 2] = Math.round(THREE.MathUtils.clamp(THREE.MathUtils.lerp(b, wear.b, wearAmount) * 255, 0, 255));
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
  return new THREE.MeshStandardMaterial({
    name: options.name ?? 'cold scuffed concrete',
    color,
    map: makeTexture({
      key: `${options.name ?? 'concrete'}-albedo`,
      color,
      variation: options.variation ?? 0.2,
      repeat: options.repeat ?? [7, 6],
      seed: options.seed ?? 3,
    }),
    roughnessMap: makeTexture({
      key: `${options.name ?? 'concrete'}-roughness`,
      kind: 'roughness',
      repeat: options.repeat ?? [7, 6],
      seed: (options.seed ?? 3) + 41,
    }),
    bumpMap: makeTexture({
      key: `${options.name ?? 'concrete'}-bump`,
      kind: 'bump',
      repeat: options.repeat ?? [7, 6],
      seed: (options.seed ?? 3) + 83,
    }),
    bumpScale: options.bumpScale ?? 0.045,
    aoMap: makeTexture({
      key: `${options.name ?? 'concrete'}-ao`,
      kind: 'ao',
      repeat: options.repeat ?? [7, 6],
      seed: (options.seed ?? 3) + 127,
    }),
    aoMapIntensity: options.aoMapIntensity ?? 0.42,
    metalness: options.metalness ?? 0.035,
    roughness: options.roughness ?? 0.88,
    envMapIntensity: options.envMapIntensity ?? 0.16,
  });
}

export function metal(options = {}) {
  const color = options.color ?? 0x4b5559;
  return new THREE.MeshStandardMaterial({
    name: options.name ?? 'oxidized steel',
    color,
    map: makeTexture({
      key: `${options.name ?? 'metal'}-albedo`,
      color,
      variation: options.variation ?? 0.14,
      repeat: options.repeat ?? [3, 3],
      seed: options.seed ?? 9,
    }),
    roughnessMap: makeTexture({
      key: `${options.name ?? 'metal'}-roughness`,
      kind: 'roughness',
      repeat: options.repeat ?? [3, 3],
      seed: (options.seed ?? 9) + 17,
    }),
    bumpMap: makeTexture({
      key: `${options.name ?? 'metal'}-bump`,
      kind: 'bump',
      repeat: options.repeat ?? [3, 3],
      seed: (options.seed ?? 9) + 53,
    }),
    bumpScale: options.bumpScale ?? 0.018,
    aoMap: makeTexture({
      key: `${options.name ?? 'metal'}-ao`,
      kind: 'ao',
      repeat: options.repeat ?? [3, 3],
      seed: (options.seed ?? 9) + 89,
    }),
    aoMapIntensity: options.aoMapIntensity ?? 0.32,
    metalness: options.metalness ?? 0.78,
    roughness: options.roughness ?? 0.53,
    envMapIntensity: options.envMapIntensity ?? 0.46,
  });
}

export function paintedMetal(options = {}) {
  const color = options.color ?? 0x303840;
  return new THREE.MeshStandardMaterial({
    name: options.name ?? 'worn painted metal',
    color,
    map: makeTexture({
      key: `${options.name ?? 'painted-metal'}-albedo`,
      color,
      variation: options.variation ?? 0.18,
      repeat: options.repeat ?? [4, 3],
      seed: options.seed ?? 14,
    }),
    roughnessMap: makeTexture({
      key: `${options.name ?? 'painted-metal'}-roughness`,
      kind: 'roughness',
      repeat: options.repeat ?? [4, 3],
      seed: (options.seed ?? 14) + 23,
    }),
    bumpMap: makeTexture({
      key: `${options.name ?? 'painted-metal'}-bump`,
      kind: 'bump',
      repeat: options.repeat ?? [4, 3],
      seed: (options.seed ?? 14) + 61,
    }),
    bumpScale: options.bumpScale ?? 0.026,
    aoMap: makeTexture({
      key: `${options.name ?? 'painted-metal'}-ao`,
      kind: 'ao',
      repeat: options.repeat ?? [4, 3],
      seed: (options.seed ?? 14) + 97,
    }),
    aoMapIntensity: options.aoMapIntensity ?? 0.36,
    metalness: options.metalness ?? 0.38,
    roughness: options.roughness ?? 0.68,
    envMapIntensity: options.envMapIntensity ?? 0.28,
  });
}

export function glass(options = {}) {
  return new THREE.MeshPhysicalMaterial({
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
  });
}

export function emissiveTrim(options = {}) {
  const color = new THREE.Color(options.color ?? 0xff9b38);
  return new THREE.MeshStandardMaterial({
    name: options.name ?? 'muted emissive trim',
    color: options.baseColor ?? color.clone().multiplyScalar(0.45),
    emissive: color,
    emissiveIntensity: options.intensity ?? 0.65,
    metalness: options.metalness ?? 0.2,
    roughness: options.roughness ?? 0.5,
    envMapIntensity: options.envMapIntensity ?? 0.16,
  });
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
  applyEnvironmentMap,
  captureEnvironmentMap,
};
