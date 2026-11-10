import { connectGrove, groveApi, keepAlive } from './net.js';
import { GroveScene } from './scene.js';
import { createUI } from './ui.js';
import { freshLog } from './view.js';
import { loadKoalaParts } from './koala-parts.js';
import { createDashboard } from './dashboard.js';

// The koalas are modelled in Blender; if the file is missing they fall back to built-in shapes.
await loadKoalaParts(new URL('../assets/CR_Koala.glb', import.meta.url).href);

let scene = null;
let ui = null;
const dash = createDashboard({ api: groveApi });
let lastLogId = 0;

function boot(state) {
  scene = new GroveScene(document.getElementById('stage'), { places: state.places, koalas: state.koalas, plots: state.plots });
  // a handle for checking the view in the browser (camera and scene); harmless in the game itself
  window.__grove = { scene: scene.scene, camera: scene.camera, controls: scene.controls };
  ui = createUI({ scene, api: groveApi });
  // Old lines are history, not news: no bubbles for them.
  lastLogId = state.log.at(-1)?.id ?? 0;
  keepAlive();
  let last = performance.now();
  const frame = (now) => {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    scene.update(dt, now / 1000);
    ui.tick(dt);
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
  window.grove = { scene, ui };
}

connectGrove({
  onState(state) {
    if (!scene) boot(state);
    for (const e of freshLog(state.log, lastLogId)) {
      scene.onLog(e);
      ui.onLog(e);
    }
    lastLogId = Math.max(lastLogId, state.log.at(-1)?.id ?? 0);
    scene.sync(state);
    ui.render(state);
    dash.render(state);
  },
  onOffline(err) {
    if (ui) ui.offline(err?.message);
    else {
      const el = document.getElementById('boot');
      el.textContent = err?.message || 'Connecting to the grove server…';
      el.hidden = false;
    }
  },
});
