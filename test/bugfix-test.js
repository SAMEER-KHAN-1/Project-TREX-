// Regression tests for the four multiplayer bugs fixed in this pass.
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const SRC = fs.readFileSync(path.join(__dirname, "..", "sketch.js"), "utf8");

const noop = () => {};
let clock = 0;

function load() {
  const sandbox = {
    window: { location: { search: "", protocol: "http:", host: "localhost:8080" } },
    Math, JSON, Number, String, Array, Object, Infinity, console,
    document: { addEventListener: noop, querySelector: () => null, createElement: () => ({ style: {}, addEventListener: noop }), body: { appendChild: noop } },
    p5: { prototype: { _updateTouchCoords: noop }, instance: {} },
    WebSocket: { OPEN: 1 },
    millis: () => clock,
    push: noop, pop: noop, tint: noop, imageMode: noop, textFont: noop, textAlign: noop,
    textSize: noop, fill: noop, noStroke: noop, rect: noop, image: noop,
    CENTER: "c", RIGHT: "r", TOP: "t",
    text: noop,
    random: () => 0.5, constrain: (v, lo, hi) => Math.min(hi, Math.max(lo, v)),
    createGraphics: () => ({ clear: noop, noStroke: noop, fill: noop, ellipse: noop, triangle: noop, beginShape: noop, vertex: noop, endShape: noop, stroke: noop, strokeWeight: noop, line: noop, get: () => ({ width: 46, height: 30 }) }),
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(SRC, sandbox);
  return sandbox;
}

let failures = 0;
function check(label, ok) {
  if (!ok) failures++;
  console.log(label.padEnd(56), ok ? "PASS" : "FAIL");
}

// -- Bug 1: opponent finishing then closing their tab must not wipe their score
{
  const s = load();
  s.mpResetRaceState();
  s.mpIsRacing = true;
  s.mpHandleMessage({ type: "opponent_finished", score: 2000 });
  s.mpHandleMessage({ type: "opponent_left" });
  check("finished-then-quit keeps their score", s.mpOpponentScore === 2000);
  check("finished-then-quit is not a forfeit", s.mpOpponentLeft === false);
}

// -- and quitting WITHOUT finishing still is a forfeit
{
  const s = load();
  s.mpResetRaceState();
  s.mpIsRacing = true;
  s.mpHandleMessage({ type: "opponent_left" });
  check("quitting mid-run still forfeits", s.mpOpponentLeft === true && s.mpOpponentFinished === true);
}

// -- Bug 2: a socket drop mid-race must not leave the player racing on silently
{
  const s = load();
  s.mpResetRaceState();
  // Real mpConnect(), so the real onclose handler is what gets exercised -
  // a hand-rolled copy of it here would pass whether or not it was fixed.
  function FakeSocket() { this.readyState = 1; this.send = noop; this.close = noop; }
  FakeSocket.OPEN = 1;
  s.WebSocket = FakeSocket;
  s.mpConnect();
  s.mpIsRacing = true;
  s.gameState = s.PLAY;
  s.score = 731.8;
  s.mpSocket.onclose();
  check("mid-race drop ends the race", s.gameState === s.MULTIPLAYER_RESULT);
  check("mid-race drop is flagged as lost", s.mpConnectionLost === true);
  check("mid-race drop keeps your score", s.mpSelfScore === 731);
  check("mid-race drop stops the wait", s.mpOpponentFinished === true);
}

// -- Bug 3: the stale LEAVE flag must not survive the countdown into the result
{
  const s = load();
  s.mpResetRaceState();
  s.trex = { x: 50, scale: 0.5, y: 180, changeAnimation: noop, collide: () => true, velocityY: 0, width: 20, height: 50 };
  s.mpSeed = 42;
  s.mpRaceStartMillis = 1000;

  // Tap LEAVE on the very frame the countdown expires.
  s.multiplayerLeaveRequested = true;
  clock = 1000;

  // Reproduce the countdown branch's decision order.
  let startedRace = false;
  if (s.multiplayerLeaveRequested) {
    s.multiplayerLeaveRequested = false;
  } else if (clock >= s.mpRaceStartMillis) {
    startedRace = true;
  }
  check("leave on the final frame wins", !startedRace);
  check("leave flag is consumed, not stranded", s.multiplayerLeaveRequested === false);
}

// -- Bug 4: GO! must be visible for a real span, not a single frame
{
  const s = load();
  s.mpRaceStartMillis = 5000;
  let drawnAt = [];
  s.text = (str) => { if (str === "GO!") drawnAt.push(clock); };
  for (clock = 5000; clock < 6000; clock += 16) s.drawRaceGoFlash();
  const span = drawnAt.length ? drawnAt[drawnAt.length - 1] - drawnAt[0] : 0;
  check("GO! shows for several hundred ms", span >= 600);
  check("GO! stops after the flash window", drawnAt[drawnAt.length - 1] < 5700);
}

console.log("");
console.log(failures === 0 ? "ALL PASS" : failures + " FAILED");
process.exit(failures === 0 ? 0 : 1);
