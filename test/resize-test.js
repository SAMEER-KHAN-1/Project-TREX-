// Rotation and resize: after the window changes shape, buttons must still be
// where the game thinks they are, and the touch zones must still line up.
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const SRC = fs.readFileSync(path.join(__dirname, "..", "sketch.js"), "utf8");

const noop = () => {};
let failures = 0;
function check(label, ok, extra) { if (!ok) failures++; console.log("  " + label.padEnd(44), ok ? "PASS" : "FAIL " + (extra || "")); }

let clock = 0;
const listeners = {};
let cssBox = { left: 0, top: 0, width: 600, height: 200 };
//p5's drawing-buffer density, and how many times the game has changed it
let density = 1;
let densityChanges = 0;

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
    changeAnimation: noop, setCollider: noop, collide: () => true, remove() {},
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

const canvasStyle = {};
const sandbox = {
  window: { location: { search: "", protocol: "http:", host: "h:8080", origin: "http://h:8080", pathname: "/" }, addEventListener: noop, isSecureContext: false },
  navigator: {},
  Math, JSON, Number, String, Array, Object, Infinity, console, RegExp, Set,
  document: {
    addEventListener: noop,
    querySelector: () => ({ style: canvasStyle, addEventListener: (n, fn) => { listeners[n] = fn; }, getBoundingClientRect: () => cssBox }),
    createElement: () => ({ style: {}, addEventListener: noop, select: noop, focus: noop, blur: noop, value: "" }),
    body: { appendChild: noop, removeChild: noop },
  },
  p5: { prototype: { _updateTouchCoords: noop }, instance: {} },
  localStorage: {}, millis: () => clock,
  random: (a, b) => (a === undefined ? 0.5 : b === undefined ? 0.5 * a : a + 0.5 * (b - a)),
  constrain: (v, lo, hi) => Math.min(hi, Math.max(lo, v)),
  keyDown: () => false, keyWentDown: () => false,
  createCanvas: (w, h) => { sandbox.width = w; sandbox.height = h; },
  // The real resizeCanvas updates width/height synchronously; without that the
  // test could not catch a mismatch between them and viewOffsetY.
  resizeCanvas: (w, h) => { sandbox.width = w; sandbox.height = h; },
  //the same getter/setter shape as p5's own
  pixelDensity: (d) => {
    if (d === undefined) return density;
    density = d;
    densityChanges++;
  },
  frameRate: noop, background: noop,
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
sandbox.ghostRunFrames = [fakeImage("r0")]; sandbox.ghostCollidedImage = fakeImage("gc");
sandbox.setup();
sandbox.trex.addAnimation("running", fakeImage("trex", 89, 94));
sandbox.trex.scale = 0.5;

// Apply a new window shape the way the browser would, then let the game react.
function resizeTo(screenW, screenH) {
  sandbox.windowWidth = screenW;
  sandbox.windowHeight = screenH;
  sandbox.windowResized();
  // fillScreen writes the CSS size onto the element; mirror that into the rect
  // the game reads back, as a real browser would.
  cssBox = {
    left: 0, top: 0,
    width: parseFloat(canvasStyle.width),
    height: parseFloat(canvasStyle.height),
  };
  clock += 16;
  sandbox.draw();
}

// Aim a pointer at a button's centre, in screen coordinates.
function screenPointForStrip(x, y) {
  return {
    clientX: cssBox.left + x * (cssBox.width / sandbox.width),
    clientY: cssBox.top + (y + sandbox.viewOffsetY) * (cssBox.height / sandbox.height),
    pointerType: "mouse",
  };
}

const shapes = [
  ["laptop landscape 1440x900", 1440, 900],
  ["phone portrait    390x844", 390, 844],
  ["phone landscape   844x390", 844, 390],
  ["tablet portrait  768x1024", 768, 1024],
  ["ultrawide        2560x600", 2560, 600],
  ["tiny window       320x240", 320, 240],
  ["back to portrait  390x844", 390, 844],
];

for (const [label, w, h] of shapes) {
  console.log(label);
  resizeTo(w, h);

  check("viewOffsetY is a sane number",
    isFinite(sandbox.viewOffsetY) && sandbox.viewOffsetY >= 0, String(sandbox.viewOffsetY));
  check("canvas stays 600 wide", sandbox.width === 600, String(sandbox.width));
  check("canvas is at least the playfield tall", sandbox.height >= 200, String(sandbox.height));
  check("css size is finite", isFinite(cssBox.width) && isFinite(cssBox.height) && cssBox.width > 0);

  // The real test: a click aimed at each visible button must land on it.
  sandbox.gameState = sandbox.MENU;
  clock += 16; sandbox.draw();
  let allHit = true;
  const missed = [];
  for (const b of sandbox.buttonsOnScreen()) {
    const pt = sandbox.canvasPointerToGame(screenPointForStrip(b.x, b.y));
    if (!pt || !sandbox.isOverButton(b, pt.x, pt.y)) { allHit = false; missed.push(b.y); }
  }
  check("buttons hit where they are drawn", allHit, "missed at y=" + missed.join(","));

  // Touch zones must still split inside the playfield, not above or below it.
  const upper = sandbox.isDuckTouchPoint(screenPointForStrip(300, 60));
  const lower = sandbox.isDuckTouchPoint(screenPointForStrip(300, 170));
  check("upper playfield still jumps", !upper);
  check("lower playfield still ducks", lower);
  console.log("");
}

// A resize in the middle of a run must not disturb the run itself.
sandbox.gameState = sandbox.MENU;
sandbox.menuSinglePlayerRequested = true;
clock += 16; sandbox.draw();
sandbox.trexHitsAnyObstacle = () => false;
for (let i = 0; i < 120; i++) { clock += 16; sandbox.draw(); }
const scoreBefore = sandbox.score;
const distBefore = sandbox.distanceTravelled;
resizeTo(390, 844);
resizeTo(844, 390);
console.log("mid-run rotation");
check("run keeps playing", sandbox.gameState === sandbox.PLAY);
check("score keeps climbing", sandbox.score > scoreBefore);
check("distance keeps advancing", sandbox.distanceTravelled > distBefore);
check("trex position stays valid", isFinite(sandbox.trex.y) && sandbox.trex.y > 0);
console.log("");

// Drawing resolution. The canvas is stretched by CSS to fill the screen, so the
// buffer behind it has to be sized to the pixels it really covers - p5 sizes
// it from devicePixelRatio alone, which on a 1080p monitor drew the game at
// 600 pixels wide and let the browser blow it up 3.2x into a blur.
console.log("drawing resolution");
function atRatio(ratio, screenW, screenH) {
  sandbox.window.devicePixelRatio = ratio;
  resizeTo(screenW, screenH);
  return 600 * density;
}
const bufferWidth = (ratio, w, h) => Math.round(atRatio(ratio, w, h));

check("a 1080p monitor draws every pixel", bufferWidth(1, 1920, 1080) === 1920,
  String(bufferWidth(1, 1920, 1080)));
check("a laptop draws every pixel", bufferWidth(1, 1366, 768) === 1366,
  String(bufferWidth(1, 1366, 768)));
check("a retina window draws at its own ratio", bufferWidth(2, 800, 600) === 1600,
  String(bufferWidth(2, 800, 600)));
check("a phone draws no more than it shows", bufferWidth(3, 390, 844) === 1170,
  String(bufferWidth(3, 390, 844)));
check("a 4K monitor is capped", bufferWidth(1, 3840, 2160) === sandbox.MAX_DRAWING_BUFFER_WIDTH,
  String(bufferWidth(1, 3840, 2160)));
check("a tiny window keeps one pixel per unit", bufferWidth(1, 320, 240) === 600,
  String(bufferWidth(1, 320, 240)));

// Dragging the window to a monitor with another pixel ratio changes nothing
// about its size, so no resize event says so - the frame loop has to notice.
atRatio(1, 1280, 720);
sandbox.window.devicePixelRatio = 2;
clock += 16; sandbox.draw();
check("a ratio change is noticed without a resize", Math.round(600 * density) === 2560,
  String(600 * density));

// And a steady screen must not be re-laid-out: changing the density resizes
// the canvas, which clears it and forces the browser to relayout.
const changesBefore = densityChanges;
for (let i = 0; i < 30; i++) { clock += 16; sandbox.draw(); }
check("a steady screen never re-sets the density", densityChanges === changesBefore,
  (densityChanges - changesBefore) + " changes");
sandbox.window.devicePixelRatio = 1;

console.log("");
console.log(failures === 0 ? "ALL PASS" : failures + " FAILED");
process.exit(failures === 0 ? 0 : 1);
