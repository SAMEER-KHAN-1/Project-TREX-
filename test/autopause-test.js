// Switching away from the game mid-run must pause it. Alt-tabbing to a message
// or clicking onto a second monitor used to leave the run going with nobody
// watching, and the player came back to a game over screen.
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
function startRun(s) {
  s.gameState = s.PLAY;
  s.trexHitsAnyObstacle = () => false;
  frames(s, 5);
}
function fire(s, target, name) { s.fire(target, name).forEach((fn) => fn()); }

{
  const s = load();
  startRun(s);
  fire(s, "win", "blur");
  frames(s, 2);
  check("losing window focus pauses a run", s.gameState === s.PAUSED, s.gameState);
  fire(s, "win", "blur");
  frames(s, 2);
  check("a second blur does not resume it", s.gameState === s.PAUSED, s.gameState);
}

{
  const s = load();
  startRun(s);
  s.document.visibilityState = "hidden";
  fire(s, "doc", "visibilitychange");
  frames(s, 2);
  check("hiding the tab pauses a run", s.gameState === s.PAUSED, s.gameState);
  s.document.visibilityState = "visible";
  fire(s, "doc", "visibilitychange");
  frames(s, 2);
  check("coming back leaves it paused for the player", s.gameState === s.PAUSED, s.gameState);
}

{
  const s = load();
  s.gameState = s.MENU;
  frames(s, 2);
  fire(s, "win", "blur");
  frames(s, 2);
  check("blur on the menu changes nothing", s.gameState === s.MENU, s.gameState);
  s.reset();
  frames(s, 5);
  check("and does not pause the next run", s.gameState === s.PLAY, s.gameState);
}

{
  const s = load();
  startRun(s);
  s.mpIsRacing = true;
  fire(s, "win", "blur");
  frames(s, 2);
  check("a race is never paused by looking away", s.gameState === s.PLAY, s.gameState);
}

console.log("");
console.log(failures === 0 ? "ALL PASS" : failures + " FAILED");
process.exit(failures === 0 ? 0 : 1);
