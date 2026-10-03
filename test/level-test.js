// The look of the world comes from the level table, and a level is only data.
// These cases hold the table to its shape and prove the frame is painted from
// it - so adding a level is adding an entry, nothing else.
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const SRC = fs.readFileSync(path.join(__dirname, "..", "sketch.js"), "utf8");

const noop = () => {};
let clock = 0;

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
function FakeSocket() { this.readyState = 1; this.send = noop; this.close = () => { this.readyState = 3; }; }
FakeSocket.OPEN = 1;

function load() {
  const docListeners = {};
  const winListeners = {};
  const sandbox = {
    window: {
      location: { search: "", protocol: "http:", host: "h:8080", origin: "http://h:8080", pathname: "/" },
      addEventListener: (n, fn) => { (winListeners[n] = winListeners[n] || []).push(fn); },
      isSecureContext: false,
    },
    navigator: {},
    Math, JSON, Number, String, Array, Object, Infinity, console, RegExp, Set, Date,
    document: {
      visibilityState: "visible",
      addEventListener: (n, fn) => { (docListeners[n] = docListeners[n] || []).push(fn); },
      querySelector: () => ({ style: {}, addEventListener: noop, getBoundingClientRect: () => ({ left: 0, top: 0, width: 600, height: 200 }) }),
      createElement: () => ({ style: {}, addEventListener: noop, select: noop, focus: noop, blur: noop, value: "" }),
      body: { appendChild: noop, removeChild: noop },
      execCommand: () => true,
    },
    p5: { prototype: { _updateTouchCoords: noop }, instance: {} },
    WebSocket: FakeSocket, localStorage: {}, millis: () => clock,
    random: (a, b) => (a === undefined ? 0.5 : b === undefined ? 0.5 * a : a + 0.5 * (b - a)),
    constrain: (v, lo, hi) => Math.min(hi, Math.max(lo, v)),
    keyDown: () => false, keyWentDown: () => false,
    createCanvas: noop, resizeCanvas: noop, frameRate: noop, background: (...c) => { sandbox.lastBackground = c; },
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
  sandbox.trex_running = { __name: "running" };
  sandbox.trex_collided = { __name: "collided" };
  sandbox.groundImage = fakeImage("ground", 2377, 12);
  sandbox.cloudImage = fakeImage("cloud", 92, 27);
  for (let i = 1; i <= 6; i++) sandbox["obstacle" + i] = fakeImage("cactus" + i, 50, 100);
  sandbox.gameOverImg = fakeImage("go", 381, 21);
  sandbox.restartImg = fakeImage("re", 75, 64);
  sandbox.ghostRunFrames = [fakeImage("r0"), fakeImage("r1")];
  sandbox.ghostCollidedImage = fakeImage("gc");
  sandbox.setup();
  sandbox.trex.addAnimation("running", fakeImage("trex", 89, 94));
  sandbox.trex.scale = 0.5;
  sandbox.fire = (target, name) => (target === "doc" ? docListeners : winListeners)[name] || [];
  return sandbox;
}

let failures = 0;
function check(label, ok, extra) {
  if (!ok) failures++;
  console.log(label.padEnd(54), ok ? "PASS" : "FAIL " + (extra === undefined ? "" : extra));
}
function frames(s, n) { for (let i = 0; i < n; i++) { clock += 16; s.draw(); } }

const COLOUR_KEYS = ["daySky", "nightSky", "daySand", "nightSand", "dayHills", "nightHills"];
const isRgb = (c) => Array.isArray(c) && c.length === 3 && c.every((v) => Number.isFinite(v) && v >= 0 && v <= 255);

{
  const s = load();
  check("there is at least one level", s.LEVELS.length >= 1);
  check("the game starts on the first level", s.levelIndex === 0 && s.activeLevel() === s.LEVELS[0]);
  check("the first level is the desert", s.LEVELS[0].name === "DESERT", s.LEVELS[0].name);
  check("every level is named", s.LEVELS.every((l) => typeof l.name === "string" && l.name.length > 0));
  const bad = [];
  s.LEVELS.forEach((l) => COLOUR_KEYS.forEach((k) => { if (!isRgb(l[k])) bad.push(l.name + "." + k); }));
  check("every level has all six colours as RGB", bad.length === 0, bad.join(" "));
}

{
  const s = load();
  s.gameState = s.MENU;
  frames(s, 2);
  const painted = s.lastBackground;
  const sky = s.LEVELS[0].daySky;
  check("the sky is painted in the level's day colour",
    Math.abs(painted[0] - sky[0]) < 1 && Math.abs(painted[1] - sky[1]) < 1 && Math.abs(painted[2] - sky[2]) < 1,
    JSON.stringify(painted));
  s.LEVELS[0].daySky = [10, 20, 30];
  frames(s, 2);
  check("changing the table changes the frame", s.lastBackground[0] === 10 && s.lastBackground[1] === 20 && s.lastBackground[2] === 30,
    JSON.stringify(s.lastBackground));
}

console.log("");
console.log(failures === 0 ? "ALL PASS" : failures + " FAILED");
process.exit(failures === 0 ? 0 : 1);
