// Variable jump height: how long the key is held should decide how high the
// trex goes, identically on any display refresh rate.
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const SRC = fs.readFileSync(path.join(__dirname, "..", "sketch.js"), "utf8");

const noop = () => {};
let failures = 0;
function check(label, ok, extra) { if (!ok) failures++; console.log(label.padEnd(52), ok ? "PASS" : "FAIL " + (extra || "")); }

let clock = 0;
let held = new Set();

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
    changeAnimation: noop, setCollider: noop, collide() { return this.y >= 179.999; },
    remove() {}, _getScaleX() { return this.scale; }, _getScaleY() { return this.scale; },
  };
}
function makeGroup() {
  const g = [];
  g.add = function (s) { this.push(s); };
  g.removeSprites = function () { this.length = 0; };
  g.setVelocityXEach = function (v) { this.forEach((s) => { s.velocityX = v; }); };
  return g;
}

function load() {
  const sandbox = {
    window: { location: { search: "", protocol: "http:", host: "h" }, addEventListener: noop }, navigator: {},
    Math, JSON, Number, String, Array, Object, Infinity, console, RegExp, Set,
    document: { addEventListener: noop, querySelector: () => ({ addEventListener: noop, style: {}, getBoundingClientRect: () => ({ left: 0, top: 0, width: 600, height: 200 }) }), createElement: () => ({ style: {}, addEventListener: noop, select: noop, focus: noop, blur: noop }), body: { appendChild: noop, removeChild: noop } },
    p5: { prototype: { _updateTouchCoords: noop }, instance: {} },
    localStorage: {}, millis: () => clock,
    random: (a, b) => (a === undefined ? 0.5 : b === undefined ? 0.5 * a : a + 0.5 * (b - a)),
    constrain: (v, lo, hi) => Math.min(hi, Math.max(lo, v)),
    keyDown: (k) => held.has(k), keyWentDown: () => false,
    createCanvas: noop, resizeCanvas: noop, frameRate: noop, background: noop,
    push: noop, pop: noop, translate: noop, noStroke: noop, stroke: noop, strokeWeight: noop,
    fill: noop, rect: noop, ellipse: noop, text: noop, textFont: noop, textAlign: noop,
    textSize: noop, image: noop, imageMode: noop, tint: noop, rectMode: noop, line: noop,
    drawSprites: noop, createSprite: makeSprite, Group: function () { return makeGroup(); },
    CENTER: "c", RIGHT: "r", TOP: "t", CLOSE: "close",
    width: 600, height: 200, windowWidth: 1200, windowHeight: 400,
    createGraphics: (w, h) => ({ width: w, height: h, pixels: [60, 60, 60, 255], clear: noop, image: noop, loadPixels: noop, updatePixels: noop, noStroke: noop, fill: noop, ellipse: noop, triangle: noop, beginShape: noop, vertex: noop, endShape: noop, stroke: noop, strokeWeight: noop, line: noop, get: () => fakeImage("white", w, h) }),
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(SRC, sandbox);
  sandbox.trex_running = { __name: "running" }; sandbox.trex_collided = { __name: "collided" };
  sandbox.groundImage = fakeImage("ground", 400, 20); sandbox.cloudImage = fakeImage("cloud", 40, 10);
  for (let i = 1; i <= 6; i++) sandbox["obstacle" + i] = fakeImage("cactus" + i, 50, 100);
  sandbox.gameOverImg = fakeImage("go", 190, 11); sandbox.restartImg = fakeImage("re", 72, 64);
  sandbox.ghostRunFrames = [fakeImage("r0")]; sandbox.ghostCollidedImage = fakeImage("gc");
  sandbox.setup();
  sandbox.trex.addAnimation("running", fakeImage("trex", 88, 94));
  sandbox.trex.scale = 0.5; sandbox.trex.width = 44; sandbox.trex.height = 47; sandbox.trex.y = 180;
  sandbox.menuSinglePlayerRequested = true;
  clock += 16; sandbox.draw();
  sandbox.trexHitsAnyObstacle = () => false;
  return sandbox;
}

// Jump, hold for holdMs, then let go. Returns how far the trex rose, in px.
function jumpRise(holdMs, frameMs) {
  const s = load();
  const restingY = s.trex.y;
  let peak = restingY;
  let elapsed = 0;
  held.add("space");
  for (let i = 0; i < 400; i++) {
    clock += frameMs;
    elapsed += frameMs;
    s.draw();
    s.trex.y = Math.min(restingY, s.trex.y + s.trex.velocityY);
    peak = Math.min(peak, s.trex.y);
    // Released only AFTER a frame has run with the key down. draw() has to see
    // the press at least once or no jump starts at all, so one frame is the
    // shortest input a player can physically give.
    if (elapsed >= holdMs) held.delete("space");
    if (i > 4 && s.trex.y >= restingY) break;
  }
  held.clear();
  return restingY - peak;
}

const FRAME_60 = 1000 / 60;

console.log("hold time -> rise height (60Hz)");
const holds = [0, 33, 66, 100, 150, 200, 300, 500];
const rises = holds.map((h) => jumpRise(h, FRAME_60));
holds.forEach((h, i) => {
  const label = h === 0 ? "tap" : h + "ms";
  console.log("  " + label.padStart(6) + "  ->  " + rises[i].toFixed(1).padStart(6) + " px");
});
console.log("");

// A tap must be clearly shorter than a full hold.
check("a tap jumps lower than a hold", rises[0] < rises[rises.length - 1] - 10, rises[0].toFixed(1) + " vs " + rises[rises.length - 1].toFixed(1));

// Height must never go DOWN as you hold longer.
let monotonic = true;
for (let i = 1; i < rises.length; i++) if (rises[i] < rises[i - 1] - 0.5) monotonic = false;
check("holding longer never jumps lower", monotonic);

// Holding beyond the top of the arc adds nothing more.
check("height tops out at the full jump", Math.abs(rises[rises.length - 1] - rises[rises.length - 2]) < 0.5);

// The shortest possible hop still has to clear the tallest obstacle. The
// tallest cactus image is 100px drawn at scale 0.5.
const TALLEST_OBSTACLE_PX = 100 * 0.5;
check("shortest hop clears the tallest cactus", rises[0] > TALLEST_OBSTACLE_PX, rises[0].toFixed(1) + "px vs " + TALLEST_OBSTACLE_PX + "px");

// Same hold, different refresh rates, same height - the reason this is a
// velocity ceiling rather than a per-frame multiply.
console.log("");
console.log("same 80ms hold across refresh rates");
const rates = [[60, 1000 / 60], [144, 1000 / 144], [240, 1000 / 240]];
const perRate = rates.map(([hz, ms]) => [hz, jumpRise(80, ms)]);
perRate.forEach(([hz, r]) => console.log("  " + String(hz).padStart(3) + "Hz  ->  " + r.toFixed(1).padStart(6) + " px"));
const spread = Math.max(...perRate.map((p) => p[1])) - Math.min(...perRate.map((p) => p[1]));
check("tap height is framerate independent", spread < 3, "spread " + spread.toFixed(2) + "px");

const fullSpread = (() => {
  const all = rates.map(([, ms]) => jumpRise(500, ms));
  return Math.max(...all) - Math.min(...all);
})();
check("full jump is framerate independent", fullSpread < 3, "spread " + fullSpread.toFixed(2) + "px");

console.log("");
console.log(failures === 0 ? "ALL PASS" : failures + " FAILED");
process.exit(failures === 0 ? 0 : 1);
