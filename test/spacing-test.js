// Measures the real gap between consecutive obstacles, in jump-lengths, using
// the game's own spawn code. OBSTACLE_GAP_MIN_JUMPS is meant to guarantee
// nothing ever arrives closer than 1.35 jumps apart.
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const SRC = fs.readFileSync(path.join(__dirname, "..", "sketch.js"), "utf8");

const noop = () => {};
function fakeImage(name, w, h) { return { __name: name, width: w, height: h }; }

function run(seed, obstacleCount) {
  const spawned = [];
  const sandbox = {
    window: {}, Math, JSON, Number, String, Array, Object, Infinity, console,
    document: { addEventListener: noop, querySelector: () => null, createElement: () => ({ style: {}, addEventListener: noop }), body: { appendChild: noop } },
    p5: { prototype: { _updateTouchCoords: noop }, instance: {} },
    millis: () => 0, random: () => 0.5, constrain: (v, lo, hi) => Math.min(hi, Math.max(lo, v)),
    createGraphics: () => ({ clear: noop, noStroke: noop, fill: noop, ellipse: noop, triangle: noop, beginShape: noop, vertex: noop, endShape: noop, stroke: noop, strokeWeight: noop, line: noop, get: () => fakeImage("proc", 46, 30) }),
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(SRC, sandbox);

  sandbox.crowFrame1 = fakeImage("crow1", 46, 30);
  sandbox.crowFrame2 = fakeImage("crow2", 46, 30);
  sandbox.boulderImage = fakeImage("boulder", 70, 46);
  for (let i = 1; i <= 6; i++) sandbox["obstacle" + i] = fakeImage("cactus" + i, 50, i <= 3 ? 70 : 100);

  sandbox.createSprite = function (x, y, w, h) {
    return {
      x, y, width: w, height: h, scale: 1, lifetime: 0, animation: null,
      addImage(img) { this.animation = { getFrameImage: () => img }; this.width = img.width; this.height = img.height; },
      addAnimation(n, f) { this.animation = { getFrameImage: () => f, frameDelay: 0 }; this.width = f.width; this.height = f.height; },
      _getScaleX() { return this.scale; }, _getScaleY() { return this.scale; },
    };
  };
  sandbox.obstaclesGroup = {
    length: 0,
    add(s) {
      this.length++;
      const img = s.animation.getFrameImage();
      const w = img.width * s.scale;
      // Distance travelled by the time this obstacle reaches the player at x=50.
      spawned.push({
        name: img.__name,
        arrival: sandbox.distanceTravelled + (s.x - 50),
        width: w,
        speed: sandbox.currentSpeed(),
        // Lead and companion share a spawn index, which is how the intentional
        // tight pair is told apart from a genuinely bad gap.
        group: sandbox.obstaclesSpawned,
      });
    },
  };

  sandbox.score = 0;
  sandbox.distanceTravelled = 0;
  sandbox.lastObstacleSpawnDistance = 0;
  sandbox.lastObstacleWidth = 0;
  sandbox.seedObstacleStream(seed);
  sandbox.nextObstacleGap = sandbox.rollObstacleGap(sandbox.obstacleRandom());

  let guard = 0;
  while (spawned.length < obstacleCount && guard++ < 3_000_000) {
    const dtFactor = (1000 / 60 / (1000 / 60)) * 0.5;
    sandbox.score += dtFactor;
    sandbox.distanceTravelled += sandbox.currentSpeed() * dtFactor;
    sandbox.spawnObstacles();
  }
  return spawned;
}

// One jump covers airtime * speed pixels of ground.
const AIRTIME = (2 * 13.5) / 0.8;
const MIN_JUMPS = 1.35;

let worst = Infinity, worstDesc = "";
const offenders = [];
for (let seed = 1; seed <= 40; seed++) {
  const list = run(seed, 120);
  for (let i = 1; i < list.length; i++) {
    const prev = list[i - 1], cur = list[i];
    // The crow pair is MEANT to be tight - that is the whole obstacle. Only
    // the spacing between separate spawns is supposed to honour the minimum.
    if (cur.group === prev.group) continue;
    // Clear air between the back of one obstacle and the front of the next.
    const clearance = (cur.arrival - cur.width / 2) - (prev.arrival + prev.width / 2);
    const jumps = clearance / (AIRTIME * cur.speed);
    if (jumps < worst) { worst = jumps; worstDesc = prev.name + " -> " + cur.name; }
    if (jumps < MIN_JUMPS - 0.01) offenders.push({ seed, pair: prev.name + " -> " + cur.name, jumps });
  }
}

console.log("minimum intended spacing :", MIN_JUMPS, "jump lengths");
console.log("tightest gap observed    :", worst.toFixed(2), "(" + worstDesc + ")");
console.log("gaps below the minimum   :", offenders.length);
if (offenders.length) {
  const byPair = {};
  offenders.forEach((o) => { byPair[o.pair] = (byPair[o.pair] || 0) + 1; });
  console.log("");
  console.log("which pairs are too tight:");
  Object.keys(byPair).sort((a, b) => byPair[b] - byPair[a]).forEach((p) => {
    const tightest = Math.min(...offenders.filter((o) => o.pair === p).map((o) => o.jumps));
    console.log("  " + p.padEnd(24), byPair[p] + " times, tightest " + tightest.toFixed(2));
  });
}

console.log("");
console.log(offenders.length === 0 ? "ALL PASS" : offenders.length + " GAPS BELOW THE MINIMUM");
process.exit(offenders.length === 0 ? 0 : 1);
