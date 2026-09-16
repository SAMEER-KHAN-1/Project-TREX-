// An opponent who closes the tab mid-race must visibly leave the race.
//
// Before this, a forfeit was recorded internally and shown nowhere: the ghost
// kept jogging beside you at its last position with its legs animating, the
// scoreboard kept posting their frozen score as a target to "BEAT", and the
// gap readout kept counting against a player who was gone. You only found out
// when you crashed and the result screen said you had won.
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
  // Everything the frame drew, so the checks below read the screen rather
  // than the variables behind it.
  const drawn = { text: [], images: [] };
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
    WebSocket: FakeSocket, localStorage: {}, millis: () => clock,
    random: (a, b) => (a === undefined ? 0.5 : b === undefined ? 0.5 * a : a + 0.5 * (b - a)),
    constrain: (v, lo, hi) => Math.min(hi, Math.max(lo, v)),
    keyDown: () => false, keyWentDown: () => false,
    createCanvas: noop, resizeCanvas: noop, frameRate: noop, background: noop,
    push: noop, pop: noop, translate: noop, noStroke: noop, stroke: noop, strokeWeight: noop,
    fill: noop, rect: noop, ellipse: noop, textFont: noop, textAlign: noop, textSize: noop,
    text: (str) => drawn.text.push(String(str)),
    image: (img) => drawn.images.push(img && img.__name),
    imageMode: noop, tint: noop, rectMode: noop, line: noop,
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
  sandbox.ghostRunFrames = [fakeImage("ghost-run-0"), fakeImage("ghost-run-1")];
  sandbox.ghostCollidedImage = fakeImage("ghost-collided");
  sandbox.setup();
  sandbox.trex.addAnimation("running", fakeImage("trex", 89, 94));
  sandbox.trex.scale = 0.5;
  sandbox.drawn = drawn;
  return sandbox;
}

let failures = 0;
function check(label, ok, extra) {
  if (!ok) failures++;
  console.log(label.padEnd(54), ok ? "PASS" : "FAIL " + (extra === undefined ? "" : extra));
}

// Puts a live race on screen with both players running and reporting.
function startedRace(myScore) {
  const s = load();
  s.WebSocket = FakeSocket;
  s.mpConnect();
  s.mpSocket.readyState = 1;
  s.mpHandleMessage({ type: "start", seed: 12345, countdownMs: 0 });
  clock += 50;
  s.startRace();
  s.score = myScore;
  s.mpHandleMessage({ type: "opponent_state", y: 150, crouching: false, dead: false, score: 472 });
  s.trexHitsAnyObstacle = () => false;
  return s;
}

function frame(s) {
  s.drawn.text.length = 0;
  s.drawn.images.length = 0;
  clock += 16;
  s.draw();
  return s.drawn;
}
const said = (drawn, needle) => drawn.text.some((t) => t.indexOf(needle) !== -1);
const drewGhost = (drawn) => drawn.images.some((n) => n && n.indexOf("ghost") === 0);

// -- While they are still there, the ghost and the gap are correct.
{
  const s = startedRace(600);
  const f = frame(s);
  check("a live opponent is drawn", drewGhost(f), f.images.join(","));
  check("a live opponent has a score to chase", said(f, "THEM 00472"), f.text.join(" | "));
  check("the gap is shown", said(f, "+128"), f.text.join(" | "));
}

// -- They quit mid-run.
{
  const s = startedRace(600);
  s.mpHandleMessage({ type: "opponent_left" });
  check("quitting mid-run is a forfeit", s.mpOpponentLeft === true);
  check("a quitter stops counting as alive", s.mpOpponentAlive === false);
  check("quitting raises a banner", s.mpOpponentGoneBannerUntil > clock);

  const f = frame(s);
  check("the banner says they left", said(f, "OPPONENT LEFT"), f.text.join(" | "));
  check("it does not call a quit a crash", !said(f, "OPPONENT CRASHED"));
  check("it says the race is already won", said(f, "RACE WON"), f.text.join(" | "));
  check("the ghost is taken off the track", !drewGhost(f), f.images.join(","));
  check("the scoreboard says they left", said(f, "THEM  LEFT"), f.text.join(" | "));
  check("no finish line is posted for a quitter", !said(f, "BEAT"), f.text.join(" | "));
  check("no gap is counted against a quitter", !said(f, "+128"), f.text.join(" | "));

  // The banner is temporary; the rest of the state is not.
  clock += s.MP_CRASH_BANNER_MS + 100;
  const later = frame(s);
  check("the banner clears itself", !said(later, "OPPONENT LEFT"), later.text.join(" | "));
  check("the ghost stays gone afterwards", !drewGhost(later));
  check("the scoreboard still says they left", said(later, "THEM  LEFT"));
}

// -- A crash is not a forfeit and must still behave as it did.
{
  const s = startedRace(600);
  s.mpHandleMessage({ type: "opponent_finished", score: 472 });
  const f = frame(s);
  check("a crash still says crashed", said(f, "OPPONENT CRASHED"), f.text.join(" | "));
  check("a crash is not reported as leaving", !said(f, "OPPONENT LEFT"));
  check("their crashed trex stays on the track", drewGhost(f), f.images.join(","));
  check("their crashed trex is the collided one", f.images.indexOf("ghost-collided") !== -1, f.images.join(","));
  check("a crashed score becomes a finish line", said(f, "BEAT 00472"), f.text.join(" | "));
}

// -- Quitting AFTER posting a score is the normal way to leave, not a forfeit.
{
  const s = startedRace(600);
  s.mpHandleMessage({ type: "opponent_finished", score: 472 });
  s.mpHandleMessage({ type: "opponent_left" });
  check("closing the tab after finishing is not a forfeit", s.mpOpponentLeft === false);
  check("their posted score survives it", s.mpOpponentScore === 472);
  const f = frame(s);
  check("their finish line survives it", said(f, "BEAT 00472"), f.text.join(" | "));
  check("their crashed trex survives it", drewGhost(f));
}

// -- The result screen after a forfeit.
{
  const s = startedRace(600);
  s.mpHandleMessage({ type: "opponent_left" });
  s.trexHitsAnyObstacle = () => true;
  frame(s);
  check("crashing after a forfeit shows the result", s.gameState === s.MULTIPLAYER_RESULT, s.gameState);

  s.trexHitsAnyObstacle = () => false;
  const f = frame(s);
  check("the result is a win", said(f, "YOU WIN"), f.text.join(" | "));
  check("the result says why", said(f, "OPPONENT LEFT THE RACE"), f.text.join(" | "));
  check("no rematch is offered to nobody", s.canRematch() === false);
  check("no ghost on the result screen either", !drewGhost(f));
}

console.log("");
console.log(failures === 0 ? "ALL PASS" : failures + " FAILED");
process.exit(failures === 0 ? 0 : 1);
