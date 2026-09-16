// A new personal best must reach localStorage even if the player never
// restarts - closing the tab, or switching away from it on a phone, used to
// throw the record away, because the only save was in resetGame().
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const SRC = fs.readFileSync(path.join(__dirname, "..", "sketch.js"), "utf8");

const noop = () => {};
let clock = 0;

// Counts writes as well as recording them: the live high score is beaten on
// one frame and then stays beaten for the rest of the run, so a naive "save
// whenever it's higher" would write on every frame at up to 1000fps. The
// count is what proves that isn't happening.
function makeStorage(best) {
  const store = { writes: 0, value: best === null ? undefined : String(best) };
  Object.defineProperty(store, "HighestScore", {
    get() { return store.value; },
    set(v) { store.value = String(v); store.writes++; },
    configurable: true,
  });
  return store;
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
function FakeSocket() { this.readyState = 1; this.send = noop; this.close = () => { this.readyState = 3; }; }
FakeSocket.OPEN = 1;

function load(storage) {
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
    WebSocket: FakeSocket, localStorage: storage, millis: () => clock,
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

// Runs `frames` of PLAY without dying, then optionally one fatal frame.
function play(s, frames, scoreToReach, thenDie) {
  s.gameState = s.PLAY;
  s.score = scoreToReach;
  s.trexHitsAnyObstacle = () => false;
  for (let i = 0; i < frames; i++) {
    clock += 16;
    s.draw();
  }
  if (thenDie) {
    s.trexHitsAnyObstacle = () => true;
    clock += 16;
    s.draw();
    s.trexHitsAnyObstacle = () => false;
  }
}

// -- The stored best is what the game starts from.
{
  const store = makeStorage(4200);
  const s = load(store);
  check("reads the stored best at startup", s.highScore === 4200, s.highScore);
}

// -- Beating it must not write on every frame of the rest of the run.
{
  const store = makeStorage(100);
  const s = load(store);
  play(s, 60, 900, false);
  check("live best rises during the run", s.highScore >= 900, s.highScore);
  check("a beaten best is not written every frame", store.writes === 0, store.writes + " writes");
}

// -- Dying banks it, without waiting for a restart that may never come.
{
  const store = makeStorage(100);
  const s = load(store);
  play(s, 30, 1500, true);
  check("crashing saves the new best", store.writes === 1, store.writes + " writes");
  check("the saved value is the new best", Number(store.value) === s.highScore, store.value);
  check("crashing ends the run", s.gameState === s.END);
}

// -- A worse run afterwards writes nothing at all.
{
  const store = makeStorage(100);
  const s = load(store);
  play(s, 30, 1500, true);
  const afterFirst = store.writes;
  s.reset();
  play(s, 30, 40, true);
  s.reset();
  check("a worse run writes nothing more", store.writes === afterFirst, store.writes + " writes");
  check("a worse run leaves the best alone", Number(store.value) >= 1500, store.value);
}

// -- Switching away mid-run (phone lock, tab switch) banks it. This is the
//    one that matters on mobile: the page may never be resumed.
{
  const store = makeStorage(100);
  const s = load(store);
  play(s, 30, 2400, false);
  s.document.visibilityState = "visible";
  s.fire("doc", "visibilitychange").forEach((fn) => fn());
  check("still-visible page saves nothing", store.writes === 0, store.writes + " writes");

  s.document.visibilityState = "hidden";
  s.fire("doc", "visibilitychange").forEach((fn) => fn());
  check("hiding the tab mid-run saves the best", store.writes === 1, store.writes + " writes");
  check("the value saved on hide is right", Number(store.value) === s.highScore, store.value);

  // Hidden twice, or hidden and then closed, must not write twice.
  s.fire("doc", "visibilitychange").forEach((fn) => fn());
  s.fire("win", "pagehide").forEach((fn) => fn());
  check("a second departure writes nothing", store.writes === 1, store.writes + " writes");
}

// -- Closing the tab straight from the game-over screen.
{
  const store = makeStorage(100);
  const s = load(store);
  play(s, 30, 3100, true);
  s.fire("win", "pagehide").forEach((fn) => fn());
  check("closing after a crash keeps the best", Number(store.value) === s.highScore, store.value);
  check("and does not double-write", store.writes === 1, store.writes + " writes");
}

// -- Leaving without ever beating anything must stay silent.
{
  const store = makeStorage(9999);
  const s = load(store);
  play(s, 60, 120, true);
  s.fire("win", "pagehide").forEach((fn) => fn());
  s.document.visibilityState = "hidden";
  s.fire("doc", "visibilitychange").forEach((fn) => fn());
  check("an unbeaten best is never rewritten", store.writes === 0, store.writes + " writes");
  check("the old best survives a bad run", Number(store.value) === 9999, store.value);
}

// -- A race crash ends in the result screen rather than END, and must bank the
//    score on that path too.
{
  const store = makeStorage(100);
  const s = load(store);
  s.mpResetRaceState();
  s.mpIsRacing = true;
  play(s, 20, 1800, true);
  check("a race crash saves the best too", store.writes === 1, store.writes + " writes");
  check("a race crash goes to the result", s.gameState === s.MULTIPLAYER_RESULT, s.gameState);
}

// -- Storage that throws on write (private browsing) must not break the game.
{
  const store = { writes: 0 };
  Object.defineProperty(store, "HighestScore", {
    get() { throw new Error("blocked"); },
    set() { throw new Error("blocked"); },
    configurable: true,
  });
  let threw = false;
  try {
    const s = load(store);
    play(s, 30, 1200, true);
    s.fire("win", "pagehide").forEach((fn) => fn());
  } catch (e) {
    threw = true;
  }
  check("blocked storage never throws", threw === false);
}

console.log("");
console.log(failures === 0 ? "ALL PASS" : failures + " FAILED");
process.exit(failures === 0 ? 0 : 1);
