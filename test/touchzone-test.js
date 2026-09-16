// Checks the touch duck/jump split against real device geometries, running the
// game's own fillScreen() maths rather than assuming it.
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const SRC = fs.readFileSync(path.join(__dirname, "..", "sketch.js"), "utf8");

const noop = () => {};
let failures = 0;
function check(label, ok, extra) {
  if (!ok) failures++;
  console.log("  " + label.padEnd(46), ok ? "PASS" : "FAIL " + (extra || ""));
}

// Reproduces fillScreen(): canvas is 600 wide and as tall as the screen shape
// needs; the 600x200 strip sits with 60% of the spare height above it.
function geometry(screenW, screenH) {
  const canvasH = Math.max(200, Math.round(600 * screenH / screenW));
  const viewOffsetY = Math.round((canvasH - 200) * 0.6);
  const scale = Math.min(screenW / 600, screenH / canvasH);
  return { canvasH, viewOffsetY, cssW: 600 * scale, cssH: canvasH * scale };
}

function load(screenW, screenH) {
  const g = geometry(screenW, screenH);
  const sandbox = {
    window: { location: { search: "", protocol: "http:", host: "h" } }, navigator: {},
    Math, JSON, Number, String, Array, Object, Infinity, console, RegExp,
    document: {
      addEventListener: noop,
      querySelector: () => ({ style: {}, addEventListener: noop, getBoundingClientRect: () => ({ left: 0, top: 0, width: g.cssW, height: g.cssH }) }),
      createElement: () => ({ style: {}, addEventListener: noop, select: noop }),
      body: { appendChild: noop, removeChild: noop },
    },
    p5: { prototype: { _updateTouchCoords: noop }, instance: {} },
    millis: () => 0, random: () => 0.5, constrain: (v, lo, hi) => Math.min(hi, Math.max(lo, v)),
    createGraphics: () => ({ clear: noop, noStroke: noop, fill: noop, ellipse: noop, triangle: noop, beginShape: noop, vertex: noop, endShape: noop, stroke: noop, strokeWeight: noop, line: noop, get: () => ({ width: 46, height: 30 }) }),
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(SRC, sandbox);
  sandbox.width = 600;
  sandbox.height = g.canvasH;
  sandbox.viewOffsetY = g.viewOffsetY;
  return { s: sandbox, g };
}

// Turn a point in gameplay-strip coordinates into a screen touch.
function touchAtStripY(g, stripY) {
  const canvasY = stripY + g.viewOffsetY;
  return { clientX: g.cssW / 2, clientY: canvasY * (g.cssH / g.canvasH) };
}

// The old, broken rule: split on half the whole canvas.
function oldRuleSaysDuck(g, stripY) {
  const canvasY = stripY + g.viewOffsetY;
  return (canvasY * (g.cssH / g.canvasH)) / g.cssH > 0.5;
}

const devices = [
  ["phone portrait   400x800", 400, 800],
  ["phone landscape  800x400", 800, 400],
  ["tablet portrait  768x1024", 768, 1024],
  ["laptop          1440x900", 1440, 900],
  ["ultrawide       1800x600", 1800, 600],
];

for (const [label, w, h] of devices) {
  const { s, g } = load(w, h);
  console.log(label + "   (strip at canvas y " + g.viewOffsetY + "-" + (g.viewOffsetY + 200) + ")");

  // Sky well above the playfield, the dino's head area, and its feet.
  check("sky above the strip jumps", !s.isDuckTouchPoint(touchAtStripY(g, -60)));
  check("top of the playfield jumps", !s.isDuckTouchPoint(touchAtStripY(g, 40)));
  check("dino head height jumps", !s.isDuckTouchPoint(touchAtStripY(g, 95)));
  check("below the dino ducks", s.isDuckTouchPoint(touchAtStripY(g, 150)));
  check("ground level ducks", s.isDuckTouchPoint(touchAtStripY(g, 185)));

  // Show where the old rule disagreed - the actual reported symptom.
  const broken = [40, 95].filter((y) => oldRuleSaysDuck(g, y));
  if (broken.length) {
    console.log("     old rule wrongly ducked at strip y: " + broken.join(", "));
  }
  console.log("");
}

console.log(failures === 0 ? "ALL PASS" : failures + " FAILED");
process.exit(failures === 0 ? 0 : 1);
