import * as THREE from 'three';

const FIXED_TIME_SECONDS = 2.4;
const DEFAULT_CAMERA = {
  name: 'center-light-pool',
  position: [-5.4, 1.65, 2.9],
  target: [-1.9, 0.18, -0.1],
  fov: 52,
};

function seededRandom(seed = 0x5eed1234) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

export function installVisualDeterminism() {
  if (window.__nightShiftVisualDeterminismInstalled) return;
  window.__nightShiftVisualDeterminismInstalled = true;
  Math.random = seededRandom();
}

function setCamera(game, fixture = DEFAULT_CAMERA) {
  const camera = game.player.camera;
  const { position = DEFAULT_CAMERA.position, target = DEFAULT_CAMERA.target, fov = DEFAULT_CAMERA.fov } = fixture;

  camera.fov = fov;
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.position.fromArray(position);
  camera.lookAt(new THREE.Vector3().fromArray(target));
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld(true);

  return {
    name: fixture.name ?? DEFAULT_CAMERA.name,
    position,
    target,
    fov,
  };
}

function freezeLights(game) {
  if (!game.lights) return;
  game.lights._time = 0;
  game.lights.update(FIXED_TIME_SECONDS);
}

function freezePost(game) {
  const post = game.post;
  if (!post) return;
  if (post.grain) {
    post.grain.intensity = 0;
    const timeUniform = post.grain.uniforms?.get?.('time');
    if (timeUniform) timeUniform.value = FIXED_TIME_SECONDS;
  }
  post.applyBudget?.({ bloomEnabled: true, smaaEnabled: true, pixelRatio: 1 });
}

function renderFixedFrame(game) {
  freezeLights(game);
  freezePost(game);
  game.renderer.setPixelRatio(1);
  game.renderer.setSize(window.innerWidth, window.innerHeight, false);
  game.post?.setSize?.(window.innerWidth, window.innerHeight);
  if (game.post?.render) {
    game.post.render();
  } else {
    game.renderer.render(game.scene, game.player.camera);
  }
}

function prepareDom() {
  document.body.classList.add('ns-running', 'ns-visual');
  document.getElementById('boot')?.classList.add('hidden');
  const ui = document.getElementById('ui');
  if (ui) ui.style.display = 'none';
}

export function installVisualHarness(game) {
  prepareDom();
  game.frameLock?.stop?.();
  game.running = true;
  game.clock?.stop?.();
  game.audio.enabled = false;

  const api = {
    ready: true,
    fixedTimeSeconds: FIXED_TIME_SECONDS,
    setCamera(fixture = DEFAULT_CAMERA) {
      const applied = setCamera(game, fixture);
      renderFixedFrame(game);
      return applied;
    },
    render() {
      renderFixedFrame(game);
      return true;
    },
  };

  window.__nightShiftVisual = api;
  api.setCamera(DEFAULT_CAMERA);
  window.dispatchEvent(new CustomEvent('night-shift:visual-ready'));
  return api;
}
