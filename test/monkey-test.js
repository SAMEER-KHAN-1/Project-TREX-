// Randomised stress run: bash the game with arbitrary input, pointer events
// and network messages for a long time and check nothing throws, wedges, or
// goes numerically wrong.
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const SRC = fs.readFileSync(path.join(__dirname, "..", "sketch.js"), "utf8");

const noop = () => {};
let clock = 0;
let held = new Set();
let fresh = new Set();
const listeners = {};

// Deterministic PRNG so a failure can be reproduced from its seed.
function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

function fakeImage(name, w, h) {
  const width = w || 88, height = h || 94;
  return { __name: name, width, height, pixels: new Array(width * height * 4).fill(255), loadPixels: noop };
}
function makeSprite(x, y, w, h) {
  return {
    x, y, width: w, height: h, scale: 1, depth: 0, visible: true,
    velocityX: 0, velocityY: 0, lifetime: 0, animation: null, baseVelocityX: 0,
    addImage(i) { this.animation = { getFrameImage: () => i }; this.width = i.width; this.height = i.height; },
    addAnimation(n, f) { this.animation = { getFrameImage: () => f, frameDelay: 0 }; this.width = f.width; this.height = f.height; },
    changeAnimation: noop, setCollider: noop, collide() { return this.y >= 179; },
    remove() { this.__removed = true; },
    _getScaleX() { return this.scale; }, _getScaleY() { return this.scale; },
  };
}
function makeGroup() {
  const g = [];
  g.add = function (s) { this.push(s); };
  g.removeSprites = function () { this.length = 0; };
  g.setVelocityXEach = function (v) { this.forEach((s) => { s.velocityX = v; }); };
  return g;
}
function FakeSocket() {
  this.readyState = 1;
  this.send = noop;
  this.close = () => { this.readyState = 3; };
}
FakeSocket.OPEN = 1;

function load() {
  const sandbox = {
    window: { location: { search: "", protocol: "http:", host: "h:8080", origin: "http://h:8080", pathname: "/" }, addEventListener: noop, isSecureContext: false },
    navigator: {},
    Math, JSON, Number, String, Array, Object, Infinity, console, RegExp, Set, Date,
    document: {
      addEventListener: noop,
      querySelector: () => ({ style: {}, addEventListener: (n, fn) => { listeners[n] = fn; }, getBoundingClientRect: () => ({ left: 0, top: 0, width: 600, height: 200 }) }),
      createElement: () => ({ style: {}, addEventListener: noop, select: noop, focus: noop, blur: noop, value: "" }),
      body: { appendChild: noop, removeChild: noop },
      execCommand: () => true,
    },
    p5: { prototype: { _updateTouchCoords: noop }, instance: {} },
    WebSocket: FakeSocket, localStorage: {}, millis: () => clock,
    random: (a, b) => (a === undefined ? 0.5 : b === undefined ? 0.5 * a : a + 0.5 * (b - a)),
    constrain: (v, lo, hi) => Math.min(hi, Math.max(lo, v)),
    keyDown: (k) => held.has(k), keyWentDown: (k) => fresh.has(k),
    createCanvas: noop, resizeCanvas: noop, frameRate: noop, background: noop,
    push: noop, pop: noop, translate: noop, noStroke: noop, stroke: noop, strokeWeight: noop,
    fill: noop, rect: noop, ellipse: noop, text: noop, textFont: noop, textAlign: noop,
    textSize: noop, image: noop, imageMode: noop, tint: noop, rectMode: noop, line: noop,
    drawSprites: noop, createSprite: makeSprite, Group: function () { return makeGroup(); },
    CENTER: "c", RIGHT: "r", TOP: "t", LEFT: "l", BOTTOM: "b", CORNER: "corner", CLOSE: "close",
    width: 600, height: 200, windowWidth: 1200, windowHeight: 400,
    createGraphics: (w, h) => ({ width: w, height: h, pixels: [60, 60, 60, 255], clear: noop, image: noop, loadPixels: noop, updatePixels: noop, noStroke: noop, fill: noop, ellipse: noop, triangle: noop, beginShape: noop, vertex: noop, endShape: noop, stroke: noop, strokeWeight: noop, line: noop, get: () => fakeImage("white", w, h) }),
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(SRC, sandbox);
  sandbox.trex_running = { __name: "running" }; sandbox.trex_collided = { __name: "collided" };
  sandbox.groundImage = fakeImage("ground", 2377, 12); sandbox.cloudImage = fakeImage("cloud", 92, 27);
  for (let i = 1; i <= 6; i++) sandbox["obstacle" + i] = fakeImage("cactus" + i, 50, 100);
  sandbox.gameOverImg = fakeImage("go", 381, 21); sandbox.restartImg = fakeImage("re", 75, 64);
  sandbox.ghostRunFrames = [fakeImage("r0"), fakeImage("r1")]; sandbox.ghostCollidedImage = fakeImage("gc");
  sandbox.setup();
  sandbox.trex.addAnimation("running", fakeImage("trex", 89, 94));
  sandbox.trex.scale = 0.5;
  return sandbox;
}

const KEYS = ["space", "up", "w", "down", "s", "p", "m", "r", "esc", "enter", "1", "2"];
const MESSAGES = [
  () => ({ type: "created", room: "AB12" }),
  () => ({ type: "start", seed: (Math.random() * 1e9) | 0, countdownMs: 3000 }),
  () => ({ type: "opponent_state", y: 120 + Math.random() * 60, crouching: Math.random() < 0.5, dead: false, score: (Math.random() * 500) | 0 }),
  () => ({ type: "opponent_finished", score: (Math.random() * 2000) | 0 }),
  () => ({ type: "opponent_wants_rematch" }),
  () => ({ type: "opponent_left" }),
  () => ({ type: "error", message: "Room not found." }),
  () => ({ type: "garbage_nobody_sends" }),
];

function runSeed(seed, frames) {
  const rand = rng(seed);
  const s = load();
  const valid = new Set([s.PLAY, s.END, s.PAUSED, s.MENU, s.MULTIPLAYER_MENU,
    s.MULTIPLAYER_WAITING, s.MULTIPLAYER_JOIN_ENTRY, s.MULTIPLAYER_COUNTDOWN, s.MULTIPLAYER_RESULT]);
  let maxObstacles = 0;
  let maxClouds = 0;

  for (let i = 0; i < frames; i++) {
    // Random input churn.
    if (rand() < 0.15) {
      const k = KEYS[(rand() * KEYS.length) | 0];
      if (held.has(k)) held.delete(k); else { held.add(k); fresh.add(k); }
    }
    if (rand() < 0.05 && listeners.pointerdown) {
      listeners.pointerdown({ clientX: rand() * 600, clientY: rand() * 200, pointerType: rand() < 0.5 ? "mouse" : "touch" });
    }
    if (rand() < 0.05 && listeners.pointermove) {
      listeners.pointermove({ clientX: rand() * 600, clientY: rand() * 200, pointerType: "mouse" });
    }
    if (rand() < 0.03) s.onPointerRelease();
    if (rand() < 0.04) s.touchStarted({ touches: [{ clientX: rand() * 600, clientY: rand() * 200 }] });
    if (rand() < 0.04) s.touchEnded({ touches: [] });

    // Random network traffic whenever a socket exists.
    if (s.mpSocket && rand() < 0.08) {
      const msg = MESSAGES[(rand() * MESSAGES.length) | 0]();
      s.mpSocket.onmessage({ data: JSON.stringify(msg) });
    }
    if (s.mpSocket && rand() < 0.004 && s.mpSocket.onclose) s.mpSocket.onclose();
    // Malformed frames must be ignored, not fatal.
    if (s.mpSocket && rand() < 0.01) s.mpSocket.onmessage({ data: "{not json" });

    // Random crashes, so runs actually end.
    s.trexHitsAnyObstacle = () => rand() < 0.004;

    clock += 8 + rand() * 24;
    s.draw();
    fresh.clear();

    if (!valid.has(s.gameState)) return { seed, frame: i, why: "invalid gameState " + s.gameState };
    if (!isFinite(s.score) || isNaN(s.score)) return { seed, frame: i, why: "score is " + s.score };
    if (!isFinite(s.trexVY) || isNaN(s.trexVY)) return { seed, frame: i, why: "trexVY is " + s.trexVY };
    if (!isFinite(s.trex.y) || isNaN(s.trex.y)) return { seed, frame: i, why: "trex.y is " + s.trex.y };
    if (!isFinite(s.distanceTravelled)) return { seed, frame: i, why: "distance is " + s.distanceTravelled };
    if (s.mpGhostY !== null && !isFinite(s.mpGhostY)) return { seed, frame: i, why: "ghostY is " + s.mpGhostY };
    if (!isFinite(s.nextObstacleGap)) return { seed, frame: i, why: "gap is " + s.nextObstacleGap };

    maxObstacles = Math.max(maxObstacles, s.obstaclesGroup.length);
    maxClouds = Math.max(maxClouds, s.cloudsGroup.length);
  }
  return { seed, ok: true, maxObstacles, maxClouds };
}

const FRAMES = 4000;
const SEEDS = 25;
let failed = null;
let worstObstacles = 0, worstClouds = 0;

for (let seed = 1; seed <= SEEDS && !failed; seed++) {
  held.clear(); fresh.clear();
  const r = runSeed(seed, FRAMES);
  if (!r.ok) { failed = r; break; }
  worstObstacles = Math.max(worstObstacles, r.maxObstacles);
  worstClouds = Math.max(worstClouds, r.maxClouds);
}

console.log("seeds run          :", SEEDS, "x", FRAMES, "frames =", SEEDS * FRAMES, "frames");
console.log("peak live obstacles:", worstObstacles);
console.log("peak live clouds   :", worstClouds);
console.log("");
if (failed) {
  console.log("FAILED on seed " + failed.seed + " at frame " + failed.frame + ": " + failed.why);
  process.exit(1);
}
// Sprites are removed once off-screen; an ever-growing group would mean a leak.
if (worstObstacles > 40 || worstClouds > 40) {
  console.log("FAILED: sprite groups grew unbounded - likely a cleanup leak");
  process.exit(1);
}
console.log("ALL PASS - no crash, wedge, NaN or sprite leak");
