// Drives the real draw() loop frame by frame through duck/jump input, which
// is what the crow pair demands.
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const SRC = fs.readFileSync(path.join(__dirname, "..", "sketch.js"), "utf8");

const noop = () => {};
let failures = 0;
function check(label, ok, extra) { if (!ok) failures++; console.log(label.padEnd(56), ok ? "PASS" : "FAIL " + (extra || "")); }

let clock = 0;
let held = new Set();

function fakeImage(name, w, h) {
  const width = w || 88, height = h || 94;
  const img = { __name: name, width, height, pixels: new Array(width * height * 4).fill(255), loadPixels: noop };
  return img;
}
function makeSprite(x, y, w, h) {
  return {
    x, y, width: w, height: h, scale: 1, depth: 0, visible: true,
    velocityX: 0, velocityY: 0, lifetime: 0, animation: null, baseVelocityX: 0,
    addImage(i) { this.animation = { getFrameImage: () => i }; this.width = i.width; this.height = i.height; },
    addAnimation(n, f) { this.animation = { getFrameImage: () => f, frameDelay: 0 }; this.width = f.width; this.height = f.height; },
    changeAnimation: noop, setCollider: noop, collide() { return this.y >= 179; },
    remove() {}, _getScaleX() { return this.scale * (this.__hs || 1); }, _getScaleY() { return this.scale * (this.__vs || 1); },
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
  sandbox.trex.scale = 0.5;
  // p5.play applies these stretch factors; setCrouching drives them via width/height.
  Object.defineProperty(sandbox.trex, "__hs", { get() { return this.width / 44; } });
  Object.defineProperty(sandbox.trex, "__vs", { get() { return this.height / 47; } });
  sandbox.trex.width = 44; sandbox.trex.height = 47; sandbox.trex.y = 180;
  sandbox.menuSinglePlayerRequested = true;
  step(sandbox, 1);
  sandbox.trexHitsAnyObstacle = () => false;
  return sandbox;
}

function step(s, n) {
  for (let i = 0; i < n; i++) {
    clock += 16;
    s.draw();
    // p5.play integrates velocity; do it here since drawSprites is stubbed.
    s.trex.y = Math.min(180, s.trex.y + s.trex.velocityY);
  }
}

// --- Holding duck, then pressing jump while STILL holding duck.
{
  const s = load();
  held.add("down");
  step(s, 4);
  check("holding down crouches", s.isCrouching === true);

  held.add("space");          // jump pressed, duck still held
  step(s, 1);
  check("jump fires from a crouch", s.trexVY < 0, "trexVY=" + s.trexVY);
  check("jumping stands the trex up", s.isCrouching === false);

  step(s, 6);
  check("still rising with duck held", s.trexVY < 0 || s.trex.y < 179);
  check("does not re-crouch mid-ascent", s.isCrouching === false);
  held.clear();
}

// --- The crow-pair input: release duck and press jump on the SAME frame.
// This is the case the old code swallowed entirely.
{
  const s = load();
  held.add("down");
  step(s, 4);
  check("crouched before the swap", s.isCrouching === true);

  held.delete("down");
  held.add("space");          // same frame: duck released, jump pressed
  step(s, 1);
  check("same-frame duck-release + jump works", s.trexVY < 0, "trexVY=" + s.trexVY);
  held.clear();
}

// --- A held jump key must still only jump once per press.
{
  const s = load();
  held.add("space");
  step(s, 1);
  const first = s.trexVY;
  step(s, 1);
  check("held jump does not re-fire", s.trexVY > first, "vy went " + first + " -> " + s.trexVY);
  held.clear();
}

// --- Ducking still works normally on its own.
{
  const s = load();
  held.add("down");
  step(s, 4);
  check("duck squashes the trex", s.trex.height < 47);
  held.delete("down");
  step(s, 4);
  check("releasing duck stands back up", Math.abs(s.trex.height - 47) < 0.01);
}

// --- Fast-fall in mid-air is unaffected.
{
  const s = load();
  held.add("space"); step(s, 1); held.delete("space");
  step(s, 4);
  const vyNoFall = s.trexVY;
  held.add("down"); step(s, 1); held.delete("down");
  check("duck still fast-falls in the air", s.trexVY > vyNoFall);
}

console.log("");
console.log(failures === 0 ? "ALL PASS" : failures + " FAILED");
process.exit(failures === 0 ? 0 : 1);
