import './style.css';
import { Game } from './game/Game.js';

const app = document.getElementById('app');
const ui = document.getElementById('ui');
const boot = document.getElementById('boot');
const startBtn = document.getElementById('start-btn');
const bootCopy = boot?.querySelector('.boot-copy');

let game = null;
let starting = false;

function hasWebGL() {
  try {
    const canvas = document.createElement('canvas');
    return Boolean(
      window.WebGLRenderingContext &&
        (canvas.getContext('webgl2') ||
          canvas.getContext('webgl') ||
          canvas.getContext('experimental-webgl')),
    );
  } catch {
    return false;
  }
}

function setBootError(message) {
  document.body.classList.add('ns-boot-error');
  boot?.classList.add('boot-error');
  if (bootCopy) bootCopy.textContent = message;
  if (startBtn) {
    startBtn.disabled = true;
    startBtn.textContent = 'Contract unavailable';
  }
}

function hideBoot() {
  document.body.classList.add('ns-running');
  boot?.classList.add('hidden');
}

function wireAttentionTransfer(targetGame) {
  let activeDir = 0;

  const emit = (dir) => {
    if (dir === activeDir) return;
    activeDir = dir;
    targetGame.bus.emit('attention:transfer', { dir });
  };

  window.addEventListener('keydown', (event) => {
    if (event.repeat) return;
    if (event.code === 'Digit1') {
      emit(1);
    } else if (event.code === 'Digit2') {
      emit(-1);
    }
  });

  window.addEventListener('keyup', (event) => {
    if ((event.code === 'Digit1' && activeDir === 1) || (event.code === 'Digit2' && activeDir === -1)) {
      emit(0);
    }
  });

  window.addEventListener('blur', () => emit(0));
}

function bootGame() {
  if (!app || !ui || !startBtn) {
    setBootError('Boot markup is missing. Reload the contract package and try again.');
    return;
  }

  if (!hasWebGL()) {
    setBootError('NIGHT SHIFT needs WebGL to render the room. Enable hardware acceleration or try another browser.');
    return;
  }

  try {
    game = new Game(app, ui);
    wireAttentionTransfer(game);
  } catch (error) {
    console.error('Failed to initialize NIGHT SHIFT', error);
    setBootError('WebGL initialization failed. Update your graphics driver or try another browser.');
    return;
  }

  startBtn.addEventListener('click', async () => {
    if (starting) return;
    starting = true;
    startBtn.disabled = true;
    startBtn.textContent = 'Entering...';

    try {
      game.player.lockPointer();
      await game.start();
      hideBoot();
    } catch (error) {
      console.error('Failed to start NIGHT SHIFT', error);
      starting = false;
      startBtn.disabled = false;
      startBtn.textContent = 'Accept Contract';
      if (bootCopy) bootCopy.textContent = 'Could not enter the shift. Click to retry after checking browser permissions.';
    }
  });
}

bootGame();
