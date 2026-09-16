// Is the game actually beatable?
//
// Every other test checks that a rule holds. This one asks the only question
// that decides whether the game is worth playing: for each obstacle the game
// can spawn, at each speed it can spawn it at, does ANY input timing get the
// trex past it - and how wide is the window of timings that work?
//
// It answers by brute force through the real draw() loop: physics, collision
// and spawning are the game's own, and the cactus silhouettes are decoded
// from the actual PNGs, because the game collides on a per-column profile of
// the visible pixels and a solid rectangle is both taller and wider than the
// artwork inside it.
//
// The crow and the boulder are drawn procedurally with p5 drawing calls that
// this harness cannot rasterise, so they stand in as full rectangles - which
// is strictly HARSHER than the real shapes. Every result for them is
// therefore a lower bound: the real window is at least this wide. That also
// means this file deliberately makes no claim about ducking under a crow,
// which an oversized crow box cannot answer either way.
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const png = require("./tools/png");

const ROOT = path.join(__dirname, "..");
const SRC = fs.readFileSync(path.join(ROOT, "sketch.js"), "utf8");

const noop = () => {};
let clock = 0;
let held = new Set();
let fresh = new Set();

// The window below which an obstacle stops being a test of reaction and
// becomes a coin flip. Six frames is a tenth of a second at 60fps.
const MIN_WINDOW_FRAMES = 6;

// Real artwork, so the silhouette the collision code walks is the real one.
function realImage(file) {
  const decoded = png.decode(path.join(ROOT, file));
  if (!decoded) throw new Error("could not decode " + file);
  return { __name: file, width: decoded.width, height: decoded.height, pixels: decoded.pixels, loadPixels: noop };
}
// A stand-in for the procedurally drawn sprites - a solid box of the same
// size, which can only overestimate them.
function boxImage(name, w, h) {
  return { __name: name, width: w, height: h, pixels: new Array(w * h * 4).fill(255), loadPixels: noop };
}

function makeSprite(x, y, w, h) {
  return {
    x, y, width: w, height: h, scale: 1, depth: 0, visible: true,
    velocityX: 0, velocityY: 0, lifetime: 0, animation: null, baseVelocityX: 0,
    addImage(i) { this.animation = { getFrameImage: () => i }; this.width = i.width; this.height = i.height; },
    addAnimation(n, f) { this.animation = { getFrameImage: () => f, frameDelay: 0 }; this.width = f.width; this.height = f.height; },
    changeAnimation: noop, setCollider: noop,
    collide() { return this.y >= 179; },
    remove() { this.__removed = true; },
    _getScaleX() { return this.scale; },
    _getScaleY() { return this.scale; },
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
    window: { location: { search: "", protocol: "http:", host: "h:8080", origin: "http://h:8080", pathname: "/" }, addEventListener: noop, isSecureContext: false },
    navigator: {},
    Math, JSON, Number, String, Array, Object, Infinity, console, RegExp, Set, Date,
    document: {
      addEventListener: noop,
      querySelector: () => ({ style: {}, addEventListener: noop, getBoundingClientRect: () => ({ left: 0, top: 0, width: 600, height: 200 }) }),
      createElement: () => ({ style: {}, addEventListener: noop, select: noop, focus: noop, blur: noop, value: "" }),
      body: { appendChild: noop, removeChild: noop },
    },
    p5: { prototype: { _updateTouchCoords: noop }, instance: {} },
    WebSocket: function () { this.readyState = 0; this.send = noop; this.close = noop; },
    localStorage: {}, millis: () => clock,
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
    createGraphics: (w, h) => ({ width: w, height: h, pixels: [60, 60, 60, 255], clear: noop, image: noop, loadPixels: noop, updatePixels: noop, noStroke: noop, fill: noop, ellipse: noop, triangle: noop, beginShape: noop, vertex: noop, endShape: noop, stroke: noop, strokeWeight: noop, line: noop, get: () => boxImage("proc", w, h) }),
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(SRC, sandbox);
  sandbox.trex_running = { __name: "running" };
  sandbox.trex_collided = { __name: "collided" };
  sandbox.groundImage = boxImage("ground", 2377, 12);
  sandbox.cloudImage = boxImage("cloud", 92, 27);
  for (let i = 1; i <= 6; i++) sandbox["obstacle" + i] = realImage("obstacle" + i + ".png");
  sandbox.gameOverImg = boxImage("go", 381, 21);
  sandbox.restartImg = boxImage("re", 75, 64);
  sandbox.ghostRunFrames = [boxImage("r0", 89, 94)];
  sandbox.ghostCollidedImage = boxImage("gc", 89, 94);
  sandbox.setup();
  //the real running frame, so the trex collides with its true silhouette
  sandbox.trex.addAnimation("running", realImage("trex1.png"));
  sandbox.trex.scale = 0.5;
  return sandbox;
}

// One frame: the game's own draw(), then the position integration p5.play
// would have done inside drawSprites().
function step(s) {
  clock += 1000 / 60;
  s.draw();
  fresh.clear();
  s.trex.y = s.trex.y + s.trex.velocityY;
  const floor = s.GROUND_SURFACE_Y - (s.trex.height * Math.abs(s.trex._getScaleY())) / 2;
  if (s.trex.y > floor) { s.trex.y = floor; s.trexVY = 0; }
  for (const o of s.obstaclesGroup) o.x += o.velocityX;
}

function press(k, on) {
  if (on) { if (!held.has(k)) fresh.add(k); held.add(k); }
  else held.delete(k);
}

// One sandbox for the whole run, reset between attempts: reloading the sketch
// into a fresh VM context for each of several thousand timings turned a
// fifteen-second suite into a five-minute one.
const S = load();
const STAND_HEIGHT = 94 * 0.5;
//far enough out to leave a full jump's worth of runway, no further
const SPAWN_X = 300;

function reset(scoreLevel) {
  held = new Set(); fresh = new Set();
  S.setCrouching(false);
  S.obstaclesGroup.removeSprites();
  S.cloudsGroup.removeSprites();
  //only the pattern under test is on the course
  S.spawnObstacles = noop;
  S.spawnClouds = noop;
  S.gameState = S.PLAY;
  S.score = scoreLevel;
  S.trexVY = 0;
  S.trex.y = S.GROUND_SURFACE_Y - STAND_HEIGHT / 2;
  S.jumpKeyWasDown = false;
  S.deathEffectStartMillis = -1;
}

function arrivalFrame(speed) {
  return Math.ceil((SPAWN_X - S.trex.x) / (speed * 0.5));
}

// Plays one pattern with one input policy. True if the trex came out alive
// with every obstacle behind it.
function attempt(pattern, scoreLevel, policy) {
  reset(scoreLevel);
  const speed = S.currentSpeed();
  for (const part of pattern) {
    const o = makeSprite(SPAWN_X, 165, 10, 40);
    o.addImage(part.image);
    o.scale = 0.5;
    o.lifetime = -1;
    o.baseVelocityX = -speed;
    o.x = SPAWN_X + (part.dx || 0);
    o.y = part.y !== undefined
      ? part.y
      : S.GROUND_SURFACE_Y - (part.image.height * 0.5) / 2;
    S.obstaclesGroup.add(o);
  }

  const limit = arrivalFrame(speed) + 60;
  for (let f = 0; f < limit; f++) {
    const act = policy(f);
    press("space", !!act.jump);
    press("down", !!act.duck);
    step(S);
    if (S.gameState !== S.PLAY) return false;
    //everything is behind the trex and can no longer reach it
    if (S.obstaclesGroup.every((o) => o.x < 20)) return true;
  }
  return S.gameState === S.PLAY;
}

// The widest run of consecutive jump frames that survives, which is the real
// measure of whether an obstacle is fair.
function jumpWindow(pattern, scoreLevel) {
  S.score = scoreLevel;
  const last = arrivalFrame(S.currentSpeed()) + 15;
  let best = 0, run = 0, bestAt = null;
  for (let j = 0; j <= last; j++) {
    const survived = attempt(pattern, scoreLevel, (f) => ({ jump: f >= j && f < j + 10 }));
    if (survived) {
      run++;
      if (run > best) { best = run; bestAt = j - run + 1; }
    } else {
      run = 0;
    }
  }
  return { frames: best, at: bestAt };
}

let failures = 0;
function check(label, ok, extra) {
  if (!ok) failures++;
  console.log(label.padEnd(50), ok ? "PASS" : "FAIL " + (extra === undefined ? "" : extra));
}

// The speeds the game actually reaches: it starts at BASE_SPEED and climbs by
// 0.1 per 100 points to a MAX_SPEED ceiling, so these span the whole range.
const SPEEDS = [
  { name: "start", score: 0 },
  { name: "fast", score: 3000 },
  { name: "max", score: 6000 },
];

const CROW_Y = 150, COMPANION_Y = 172, PAIR_GAP = 90;

function patternsFor() {
  const list = [];
  for (let i = 1; i <= 6; i++) {
    list.push({ name: "cactus " + i + " (real art)", parts: [{ image: S["obstacle" + i] }] });
  }
  list.push({ name: "boulder (box)", parts: [{ image: boxImage("boulder", 70, 46) }] });
  list.push({ name: "crow (box)", parts: [{ image: boxImage("crow", 46, 30), y: CROW_Y }] });
  list.push({
    name: "crow pair (box)",
    parts: [
      { image: boxImage("crow-lead", 46, 30), y: CROW_Y },
      { image: boxImage("crow-companion", 46, 30), dx: PAIR_GAP, y: COMPANION_Y },
    ],
  });
  return list;
}

console.log("");
console.log("  obstacle".padEnd(30) + SPEEDS.map((s) => s.name.padStart(12)).join(""));
console.log("  " + "-".repeat(28 + 12 * SPEEDS.length));

const unclearable = [];
const tight = [];
for (const pattern of patternsFor()) {
  const cells = [];
  for (const speed of SPEEDS) {
    const win = jumpWindow(pattern.parts, speed.score);
    cells.push((win.frames + "f").padStart(12));
    if (win.frames === 0) unclearable.push(pattern.name + " at " + speed.name);
    else if (win.frames < MIN_WINDOW_FRAMES) tight.push(pattern.name + " at " + speed.name + " (" + win.frames + "f)");
  }
  console.log("  " + pattern.name.padEnd(28) + cells.join(""));
}

console.log("");
check("every obstacle can be cleared at every speed", unclearable.length === 0, unclearable.join("; "));
check("no obstacle is a coin flip (>= " + MIN_WINDOW_FRAMES + " frames)", tight.length === 0, tight.join("; "));

// The trex must also survive doing nothing on an empty course, or the numbers
// above would be measuring something other than the obstacles.
{
  const survived = attempt([], 0, () => ({}));
  check("an empty course is survivable", survived);
}

// And a cactus run straight into must still be fatal - a test that says
// everything is clearable is worthless if nothing can kill you.
{
  const intoIt = attempt([{ image: S.obstacle4 }], 0, () => ({}));
  check("running into a cactus still kills you", intoIt === false);
}

console.log("");
console.log(failures === 0 ? "ALL PASS" : failures + " FAILED");
process.exit(failures === 0 ? 0 : 1);
