// Runs the real drawOpponentGhost() under a stubbed p5 and records what it
// would have drawn.
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const SRC = fs.readFileSync(path.join(__dirname, "..", "sketch.js"), "utf8");

const noop = () => {};
let clock = 0;
const drawn = [];

const sandbox = {
  window: {}, Math, JSON, Number, String, Array, Object, Infinity, console,
  document: { addEventListener: noop, querySelector: () => null, createElement: () => ({ style: {}, addEventListener: noop }), body: { appendChild: noop } },
  p5: { prototype: { _updateTouchCoords: noop }, instance: {} },
  millis: () => clock,
  push: noop, pop: noop, tint: noop, imageMode: noop, CENTER: "center",
  image: (img, x, y, w, h) => drawn.push({ img: img.__name, x, y: +y.toFixed(2), w: +w.toFixed(2), h: +h.toFixed(2) }),
  random: () => 0.5, constrain: (v, lo, hi) => Math.min(hi, Math.max(lo, v)),
  createGraphics: (w, h) => {
    let source = null;
    //the ghost is drawn as a pre-recoloured copy of its frame rather than
    //as the frame under a live tint(), so the copy keeps the source's name -
    //these tests are about which frame is on screen, not about the tint
    return { width: w, height: h, pixels: [60, 60, 60, 255], clear: noop,
      image: (img) => { source = img; }, loadPixels: noop, updatePixels: noop,
      noStroke: noop, fill: noop, ellipse: noop, triangle: noop, beginShape: noop,
      vertex: noop, endShape: noop, stroke: noop, strokeWeight: noop, line: noop,
      get: () => ({ width: w || 46, height: h || 30, __name: source && source.__name }) };
  },
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(SRC, sandbox);

// Stand in for the assets preload() would have loaded.
sandbox.ghostRunFrames = [
  { __name: "run0", width: 88, height: 94 },
  { __name: "run1", width: 88, height: 94 },
  { __name: "run2", width: 88, height: 94 },
];
sandbox.ghostCollidedImage = { __name: "collided", width: 88, height: 94 };
sandbox.trex = { x: 50, scale: 0.5 };

function reset() {
  drawn.length = 0;
  sandbox.mpResetRaceState();
}

function check(label, ok) {
  console.log(label.padEnd(42), ok ? "PASS" : "FAIL");
}

// 1. Nothing to draw before any opponent state has arrived.
reset();
sandbox.mpIsRacing = true;
sandbox.drawOpponentGhost(16);
check("silent before first opponent state", drawn.length === 0);

// 2. Not drawn at all outside a race.
reset();
sandbox.mpOpponentY = 100;
sandbox.gameState = sandbox.MENU;
sandbox.drawOpponentGhost(16);
check("not drawn outside a race", drawn.length === 0);

// 3. Drawn at the local trex's x, snapping to the first reported y.
reset();
sandbox.mpIsRacing = true;
sandbox.mpOpponentY = 120;
sandbox.drawOpponentGhost(16);
check("drawn at local trex x", drawn.length === 1 && drawn[0].x === 50);
check("snaps to first reported y", drawn[0].y === 120);
check("scaled by trex scale (88*0.5)", drawn[0].w === 44 && drawn[0].h === 47);

// 4. Interpolates toward a new y rather than teleporting, and gets there.
sandbox.mpOpponentY = 180;
drawn.length = 0;
sandbox.drawOpponentGhost(16);
const firstStep = drawn[0].y;
check("does not teleport to new y", firstStep > 120 && firstStep < 180);
for (let i = 0; i < 300; i++) { drawn.length = 0; sandbox.drawOpponentGhost(16); }
check("converges on the reported y", Math.abs(drawn[0].y - 180) < 0.5);

// 5. Same convergence regardless of framerate: 1 frame of 64ms vs 4 of 16ms.
function convergeAfter(steps, dt) {
  reset();
  sandbox.mpIsRacing = true;
  sandbox.mpOpponentY = 100;
  sandbox.drawOpponentGhost(16);
  sandbox.mpOpponentY = 200;
  for (let i = 0; i < steps; i++) { drawn.length = 0; sandbox.drawOpponentGhost(dt); }
  return drawn[0].y;
}
const slow = convergeAfter(1, 64);
const fast = convergeAfter(4, 16);
check("framerate-independent smoothing", Math.abs(slow - fast) < 0.5);

// 6. Crouching squashes the ghost the same way the local trex squashes.
reset();
sandbox.mpIsRacing = true;
sandbox.mpOpponentY = 150;
sandbox.mpOpponentCrouching = true;
sandbox.drawOpponentGhost(16);
check("crouch widens (44*1.35)", Math.abs(drawn[0].w - 44 * 1.35) < 0.01);
check("crouch shortens (47*0.55)", Math.abs(drawn[0].h - 47 * 0.55) < 0.01);

// 7. A crashed opponent shows the collided frame, not a running one.
reset();
sandbox.mpIsRacing = true;
sandbox.mpOpponentY = 150;
sandbox.mpOpponentAlive = false;
sandbox.drawOpponentGhost(16);
check("crashed opponent uses collided art", drawn[0].img === "collided");

// 8. Running animation advances on the wall clock.
reset();
sandbox.mpIsRacing = true;
sandbox.mpOpponentY = 150;
const frames = new Set();
for (let t = 0; t < 1000; t += 40) { clock = t; drawn.length = 0; sandbox.drawOpponentGhost(16); frames.add(drawn[0].img); }
check("cycles all running frames", frames.size === 3);

// 9. Still visible after you die while they keep running.
reset();
clock = 0;
sandbox.mpIsRacing = false;
sandbox.gameState = sandbox.MULTIPLAYER_RESULT;
sandbox.mpOpponentFinished = false;
sandbox.mpOpponentY = 140;
sandbox.drawOpponentGhost(16);
check("still shown while you await them", drawn.length === 1);
