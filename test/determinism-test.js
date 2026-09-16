// Loads the real sketch.js under a minimal p5 stub and runs the actual
// spawnObstacles() at two different simulated framerates, to verify the
// obstacle sequence depends only on the seed.
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const SRC = fs.readFileSync(path.join(__dirname, "..", "sketch.js"), "utf8");

function fakeImage(name, w, h) {
  return { __name: name, width: w, height: h };
}

function makeSandbox() {
  const noop = () => {};
  const sandbox = {
    window: {},
    document: { addEventListener: noop, querySelector: () => null, createElement: () => ({ style: {}, addEventListener: noop }), body: { appendChild: noop } },
    p5: { prototype: { _updateTouchCoords: noop }, instance: {} },
    Math, JSON, Number, String, Array, Object, Infinity, console,
    millis: () => 0,
    random: (a, b) => {
      // p5-style signature; clouds and the death shake use this stream
      if (a === undefined) return Math.random();
      if (b === undefined) return Math.random() * a;
      return a + Math.random() * (b - a);
    },
    constrain: (v, lo, hi) => Math.min(hi, Math.max(lo, v)),
    createGraphics: () => ({ clear: noop, noStroke: noop, fill: noop, ellipse: noop, triangle: noop, beginShape: noop, vertex: noop, endShape: noop, stroke: noop, strokeWeight: noop, line: noop, get: () => fakeImage("proc", 46, 30) }),
  };
  sandbox.globalThis = sandbox;
  return sandbox;
}

// Records what each spawn actually decided.
function runCourse(seed, frameMs, obstacleCount) {
  const sandbox = makeSandbox();
  vm.createContext(sandbox);
  vm.runInContext(SRC, sandbox);

  const spawned = [];
  sandbox.crowFrame1 = fakeImage("crow1", 46, 30);
  sandbox.crowFrame2 = fakeImage("crow2", 46, 30);
  sandbox.boulderImage = fakeImage("boulder", 70, 46);
  for (let i = 1; i <= 6; i++) sandbox["obstacle" + i] = fakeImage("cactus" + i, 50, i <= 3 ? 70 : 100);

  sandbox.createSprite = function (x, y, w, h) {
    const s = {
      x, y, width: w, height: h, scale: 1, lifetime: 0, animation: null,
      addImage(img) { this.animation = { getFrameImage: () => img }; this.width = img.width; this.height = img.height; },
      addAnimation(name, f1) { this.animation = { getFrameImage: () => f1, frameDelay: 0 }; this.width = f1.width; this.height = f1.height; },
      _getScaleX() { return this.scale; },
      _getScaleY() { return this.scale; },
    };
    return s;
  };
  sandbox.obstaclesGroup = {
    length: 0,
    add(s) {
      this.length++;
      spawned.push({ img: s.animation.getFrameImage().__name, y: Math.round(s.y) });
    },
  };

  // Drive the run: advance score/distance one frame at a time, exactly as
  // draw() does, and let spawnObstacles() fire on its own distance thresholds.
  sandbox.score = 0;
  sandbox.distanceTravelled = 0;
  sandbox.lastObstacleSpawnDistance = 0;
  sandbox.lastObstacleWidth = 0;
  sandbox.seedObstacleStream(seed);
  sandbox.nextObstacleGap = sandbox.rollObstacleGap(sandbox.obstacleRandom());

  const TIME_SCALE = 0.5;
  let guard = 0;
  while (spawned.length < obstacleCount && guard++ < 5_000_000) {
    const dtFactor = (frameMs / (1000 / 60)) * TIME_SCALE;
    sandbox.score += dtFactor;
    sandbox.distanceTravelled += sandbox.currentSpeed() * dtFactor;
    sandbox.spawnObstacles();
  }
  return spawned;
}

const SEED = 1535255813;
const COUNT = 60;

// 60Hz vs 144Hz vs a deliberately jittery machine
const a = runCourse(SEED, 1000 / 60, COUNT);
const b = runCourse(SEED, 1000 / 144, COUNT);
const c = runCourse(SEED, 1000 / 240, COUNT);

const seqA = a.map((o) => o.img + "@" + o.y).join(",");
const seqB = b.map((o) => o.img + "@" + o.y).join(",");
const seqC = c.map((o) => o.img + "@" + o.y).join(",");

console.log("first 12 obstacles @60Hz :", a.slice(0, 12).map((o) => o.img).join(" "));
console.log("first 12 obstacles @144Hz:", b.slice(0, 12).map((o) => o.img).join(" "));
console.log("first 12 obstacles @240Hz:", c.slice(0, 12).map((o) => o.img).join(" "));
console.log("");
var failures = 0;
function note(label, ok) { if (!ok) failures++; console.log(label, ok ? "PASS" : "FAIL"); }
note("60Hz === 144Hz :", seqA === seqB);
note("60Hz === 240Hz :", seqA === seqC);

// A different seed must give a genuinely different course, or every race
// would run the same track.
const d = runCourse(SEED + 1, 1000 / 60, COUNT);
const seqD = d.map((o) => o.img + "@" + o.y).join(",");
note("different seed differs :", seqA !== seqD);
console.log("other seed's first 12  :", d.slice(0, 12).map((o) => o.img).join(" "));

// Type distribution sanity: all eight types should show up.
const counts = {};
runCourse(SEED, 1000 / 60, 400).forEach((o) => { counts[o.img] = (counts[o.img] || 0) + 1; });
console.log("");
console.log("distribution over 400   :", JSON.stringify(counts));

const crowIndexes = a.map((o, i) => (o.img.startsWith("crow") ? i : -1)).filter((i) => i >= 0);
console.log("crow indexes (min 2)    :", crowIndexes.slice(0, 8).join(",") || "none");

console.log("");
console.log(failures === 0 ? "ALL PASS" : failures + " FAILED");
process.exit(failures === 0 ? 0 : 1);
