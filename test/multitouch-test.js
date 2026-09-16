// Multi-touch handling, on a portrait phone's real geometry.
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const SRC = fs.readFileSync(path.join(__dirname, "..", "sketch.js"), "utf8");

const noop = () => {};
let failures = 0;
function check(label, ok) { if (!ok) failures++; console.log(label.padEnd(54), ok ? "PASS" : "FAIL"); }

// 400x800 portrait: canvas 600x1200, strip at canvas y 600-800.
const CANVAS_H = 1200, VIEW_OFFSET = 600, CSS_W = 400, CSS_H = 800;

const sandbox = {
  window: { location: { search: "", protocol: "http:", host: "h" } }, navigator: {},
  Math, JSON, Number, String, Array, Object, Infinity, console, RegExp,
  document: {
    addEventListener: noop,
    querySelector: () => ({ style: {}, addEventListener: noop, getBoundingClientRect: () => ({ left: 0, top: 0, width: CSS_W, height: CSS_H }) }),
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
sandbox.height = CANVAS_H;
sandbox.viewOffsetY = VIEW_OFFSET;
sandbox.gameState = sandbox.PLAY;

// A finger at a given gameplay-strip y.
function finger(stripY) {
  return { clientX: CSS_W / 2, clientY: (stripY + VIEW_OFFSET) * (CSS_H / CANVAS_H) };
}
const JUMP = finger(60);   // upper playfield
const DUCK = finger(170);  // down by the ground
const state = () => (sandbox.touchIsDown ? "J" : "-") + (sandbox.touchDuckIsDown ? "D" : "-");

// The crow-pair sequence: duck, then jump with a second finger while still
// holding the duck, then release them one at a time.
sandbox.touchStarted({ touches: [DUCK] });
check("one finger low ducks", state() === "-D");

sandbox.touchStarted({ touches: [DUCK, JUMP] });
check("second finger up top also jumps", state() === "JD");

sandbox.touchEnded({ touches: [DUCK] });
check("releasing jump keeps the duck held", state() === "-D");

sandbox.touchEnded({ touches: [] });
check("releasing the last finger clears both", state() === "--");

// The same in the other order.
sandbox.touchStarted({ touches: [JUMP] });
check("one finger high jumps", state() === "J-");
sandbox.touchStarted({ touches: [JUMP, DUCK] });
check("adding a low finger also ducks", state() === "JD");
sandbox.touchEnded({ touches: [JUMP] });
check("releasing duck keeps the jump held", state() === "J-");
sandbox.touchEnded({ touches: [] });
check("all clear", state() === "--");

// Two fingers in the same zone, one lifted: the zone stays held.
sandbox.touchStarted({ touches: [DUCK, finger(185)] });
check("two low fingers duck", state() === "-D");
sandbox.touchEnded({ touches: [finger(185)] });
check("one low finger lifted, still ducking", state() === "-D");
sandbox.touchEnded({ touches: [] });

// A system gesture interrupting mid-touch.
sandbox.touchStarted({ touches: [DUCK, JUMP] });
sandbox.touchEnded({ touches: [] }); // touchcancel shape
check("cancelled touches clear both", state() === "--");

// Outside gameplay every tap is a press, so game-over taps restart.
sandbox.gameState = sandbox.END;
sandbox.touchStarted({ touches: [DUCK] });
check("low tap on game over is a press", state() === "J-");
sandbox.touchEnded({ touches: [] });
sandbox.gameState = sandbox.PLAY;

// Mouse still works: p5 routes it here with no touches list.
sandbox.touchStarted({});
check("mouse press registers as a jump", state() === "J-");
sandbox.touchEnded({});
check("mouse release clears it", state() === "--");
sandbox.touchStarted(undefined);
check("missing event does not crash", state() === "J-");
sandbox.touchEnded(undefined);

console.log("");
console.log(failures === 0 ? "ALL PASS" : failures + " FAILED");
process.exit(failures === 0 ? 0 : 1);
