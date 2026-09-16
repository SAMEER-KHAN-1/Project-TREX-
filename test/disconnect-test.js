// What the result screen does when the other side goes away.
//
// Two distinct failures lived here. A rematch was offered after the opponent
// closed their tab, which the server can never honour - it deletes the room
// the moment a seat empties - so the screen waited for an acceptance forever.
// And a socket dropping while an already-decided result was on screen
// relabelled that result "CONNECTION LOST - THE RACE COULD NOT BE SCORED",
// throwing away a race that had been scored perfectly well.
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
// Behaves like a real WebSocket to the extent that matters here: it reports a
// readyState, and closing it fires onclose - which is what a dropped
// connection actually looks like from inside the game.
function FakeSocket() {
  this.readyState = 1;
  this.sent = [];
  this.send = (raw) => this.sent.push(JSON.parse(raw));
  this.close = () => { this.readyState = 3; };
  this.drop = () => {
    this.readyState = 3;
    if (this.onclose) this.onclose();
  };
}
FakeSocket.OPEN = 1;

function load() {
  const drawn = { text: [] };
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
    image: noop, imageMode: noop, tint: noop, rectMode: noop, line: noop,
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

function frame(s) {
  s.drawn.text.length = 0;
  clock += 16;
  s.draw();
  return s.drawn;
}
const said = (drawn, needle) => drawn.text.some((t) => t.indexOf(needle) !== -1);

// A race in progress, both players connected and running.
function racing() {
  const s = load();
  s.mpConnect();
  s.mpSocket.onopen();
  s.mpHandleMessage({ type: "created", room: "AB12" });
  s.mpHandleMessage({ type: "start", seed: 777, countdownMs: 0 });
  clock += 50;
  s.startRace();
  s.trexHitsAnyObstacle = () => false;
  return s;
}

// ...and carried through to a finished, scored result on both sides.
function decidedResult(myScore, theirScore) {
  const s = racing();
  s.score = myScore;
  s.mpHandleMessage({ type: "opponent_state", y: 150, crouching: false, dead: false, score: theirScore });
  s.trexHitsAnyObstacle = () => true;
  frame(s);
  s.trexHitsAnyObstacle = () => false;
  s.mpHandleMessage({ type: "opponent_finished", score: theirScore });
  //the fatal frame advances the score a little before the crash lands, so the
  //final is read back rather than assumed to be what was set above
  s.finalSelf = s.mpSelfScore;
  return s;
}

// -- The baseline: both still connected, a rematch is on the table.
{
  const s = decidedResult(1200, 800);
  const f = frame(s);
  check("a decided result shows both scores",
    said(f, "YOU  " + s.padScore(s.finalSelf)) && said(f, "THEM 00800"), f.text.join(" | "));
  check("a rematch is offered while both are here", s.canRematch() === true);
  check("nothing claims a disconnect", !said(f, "NO REMATCH"), f.text.join(" | "));
}

// -- The ordinary ending: they post a score, then close the tab.
{
  const s = decidedResult(1200, 800);
  s.mpHandleMessage({ type: "opponent_left" });
  check("leaving after finishing is still not a forfeit", s.mpOpponentLeft === false);
  check("but they are no longer present", s.mpOpponentPresent === false);
  check("no rematch is offered into an empty room", s.canRematch() === false);

  const f = frame(s);
  check("their score still stands", said(f, "THEM 00800"), f.text.join(" | "));
  check("the result is still a win", said(f, "YOU WIN"), f.text.join(" | "));
  check("the missing rematch is explained", said(f, "NO REMATCH - OPPONENT DISCONNECTED"), f.text.join(" | "));
  check("nothing waits on an acceptance", !said(f, "WAITING FOR THEM"), f.text.join(" | "));

  // Asking anyway must be refused locally rather than sent into the void.
  const before = s.mpSocket.sent.length;
  s.mpRequestRematch();
  check("a rematch request is not even sent", s.mpSocket.sent.length === before);
  check("and nothing starts waiting", s.mpRematchRequested === false);
}

// -- The socket drops while a decided result is on screen.
{
  const s = decidedResult(1200, 800);
  s.mpSocket.drop();
  check("a decided race is not marked unscoreable", s.mpConnectionLost === false);
  check("your score survives the drop", s.mpSelfScore === s.finalSelf, s.mpSelfScore);
  check("their score survives the drop", s.mpOpponentScore === 800, s.mpOpponentScore);
  check("the drop does not bounce you to the menu", s.gameState === s.MULTIPLAYER_RESULT, s.gameState);

  const f = frame(s);
  check("the result is still shown", said(f, "YOU WIN") && said(f, "THEM 00800"), f.text.join(" | "));
  check("it is not relabelled connection lost", !said(f, "CONNECTION LOST"), f.text.join(" | "));
  check("the rematch is withdrawn with a reason", said(f, "NO REMATCH - OPPONENT DISCONNECTED"));
}

// -- The socket drops while still waiting for their score, which can now never
//    arrive. That one IS unscoreable, and must not wait forever.
{
  const s = racing();
  s.score = 940;
  s.trexHitsAnyObstacle = () => true;
  frame(s);
  check("crashing waits on their score", s.gameState === s.MULTIPLAYER_RESULT && s.mpOpponentFinished === false);

  s.trexHitsAnyObstacle = () => false;
  s.mpSocket.drop();
  check("the drop stops the wait", s.mpOpponentFinished === true);
  check("the drop is reported as lost", s.mpConnectionLost === true);
  const f = frame(s);
  check("the screen says the race was not scored", said(f, "COULD NOT BE SCORED"), f.text.join(" | "));
  check("no rematch is offered after a drop", s.canRematch() === false);
  check("and it does not also claim a disconnect twice", !said(f, "NO REMATCH"), f.text.join(" | "));
}

// -- A drop mid-run, before crashing, is unchanged.
{
  const s = racing();
  s.score = 450;
  s.mpSocket.drop();
  check("a mid-run drop ends the race", s.gameState === s.MULTIPLAYER_RESULT);
  check("a mid-run drop keeps your score", s.mpSelfScore === 450, s.mpSelfScore);
  check("a mid-run drop is reported as lost", s.mpConnectionLost === true);
}

// -- A drop in the lobby must tear the session down, not leave a dead socket
//    and a stale room code lying around for the next screen.
{
  const s = load();
  s.mpCreateRoom();
  s.mpSocket.onopen();
  s.mpHandleMessage({ type: "created", room: "AB12" });
  s.gameState = s.MULTIPLAYER_WAITING;
  const socket = s.mpSocket;
  socket.drop();
  check("a lobby drop returns to the menu", s.gameState === s.MULTIPLAYER_MENU, s.gameState);
  check("a lobby drop says what happened", /lost connection/i.test(s.mpConnectionMessage || ""), s.mpConnectionMessage);
  check("a lobby drop releases the socket", s.mpSocket === null);
  check("a lobby drop clears the room code", s.mpRoomCode === null);
  check("a lobby drop clears the race seed", s.mpSeed === null);
}

console.log("");
console.log(failures === 0 ? "ALL PASS" : failures + " FAILED");
process.exit(failures === 0 ? 0 : 1);
