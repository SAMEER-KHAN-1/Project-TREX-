// Drives the real draw() loop through every screen and transition, looking for
// thrown errors and wrong states. This is the closest thing to actually
// playing the game that runs without a browser.
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const SRC = fs.readFileSync(path.join(__dirname, "..", "sketch.js"), "utf8");

const noop = () => {};
let failures = 0;
function check(label, ok, extra) {
  if (!ok) failures++;
  console.log(label.padEnd(50), ok ? "PASS" : "FAIL " + (extra === undefined ? "" : extra));
}

let clock = 0;
let heldKeys = new Set();
let freshKeys = new Set();
const sentMessages = [];

function fakeImage(name, w, h) {
  const width = w || 88, height = h || 94;
  const img = { __name: name, width, height };
  // Solid opaque block, so the silhouette collision code has real spans to
  // work with rather than an empty image.
  img.pixels = new Array(width * height * 4).fill(255);
  img.loadPixels = () => {};
  return img;
}

function makeSprite(x, y, w, h) {
  return {
    x, y, width: w, height: h, scale: 1, depth: 0, visible: true,
    velocityX: 0, velocityY: 0, lifetime: 0, animation: null, baseVelocityX: 0,
    addImage(img) { this.animation = { getFrameImage: () => img }; this.width = img.width; this.height = img.height; },
    addAnimation(name, f1) { this.animation = { getFrameImage: () => f1, frameDelay: 0 }; this.width = f1.width; this.height = f1.height; },
    changeAnimation: noop,
    setCollider: noop,
    collide: () => true,
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

function FakeSocket() {
  this.readyState = 1;
  this.send = (m) => sentMessages.push(JSON.parse(m));
  this.close = () => { this.readyState = 3; };
}
FakeSocket.OPEN = 1;

function load() {
  const sandbox = {
    window: { location: { search: "", protocol: "http:", host: "h:8080", origin: "http://h:8080", pathname: "/" }, isSecureContext: false, addEventListener: noop },
    navigator: {},
    Math, JSON, Number, String, Array, Object, Infinity, console, RegExp, Set, Date,
    document: {
      addEventListener: noop,
      querySelector: () => ({ addEventListener: noop, style: {}, getBoundingClientRect: () => ({ left: 0, top: 0, width: 600, height: 200 }) }),
      createElement: () => ({ style: {}, addEventListener: noop, select: noop, focus: noop, blur: noop }),
      body: { appendChild: noop, removeChild: noop },
    },
    p5: { prototype: { _updateTouchCoords: noop }, instance: {} },
    WebSocket: FakeSocket,
    localStorage: {},
    millis: () => clock,
    random: (a, b) => (a === undefined ? 0.5 : b === undefined ? 0.5 * a : a + 0.5 * (b - a)),
    constrain: (v, lo, hi) => Math.min(hi, Math.max(lo, v)),
    keyDown: (k) => heldKeys.has(k),
    keyWentDown: (k) => freshKeys.has(k),
    createCanvas: noop, resizeCanvas: noop, frameRate: noop, background: noop,
    push: noop, pop: noop, translate: noop, noStroke: noop, stroke: noop, strokeWeight: noop,
    fill: noop, rect: noop, ellipse: noop, text: noop, textFont: noop, textAlign: noop,
    textSize: noop, image: noop, imageMode: noop, tint: noop, rectMode: noop, line: noop,
    drawSprites: noop, createSprite: makeSprite,
    Group: function () { return makeGroup(); },
    CENTER: "c", RIGHT: "r", TOP: "t", CLOSE: "close",
    width: 600, height: 200, windowWidth: 1200, windowHeight: 400,
    createGraphics: (w, h) => ({
      width: w, height: h, pixels: [60, 60, 60, 255, 0, 0, 0, 0],
      clear: noop, image: noop, loadPixels: noop, updatePixels: noop, noStroke: noop,
      fill: noop, ellipse: noop, triangle: noop, beginShape: noop, vertex: noop,
      endShape: noop, stroke: noop, strokeWeight: noop, line: noop,
      get: () => fakeImage("white", w, h),
    }),
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(SRC, sandbox);

  // Stand in for preload()'s assets.
  sandbox.trex_running = { __name: "running" };
  sandbox.trex_collided = { __name: "collided" };
  sandbox.groundImage = fakeImage("ground", 400, 20);
  sandbox.cloudImage = fakeImage("cloud", 40, 10);
  for (let i = 1; i <= 6; i++) sandbox["obstacle" + i] = fakeImage("cactus" + i, 50, 100);
  sandbox.gameOverImg = fakeImage("gameover", 190, 11);
  sandbox.restartImg = fakeImage("restart", 72, 64);
  sandbox.ghostRunFrames = [fakeImage("r0"), fakeImage("r1"), fakeImage("r2")];
  sandbox.ghostCollidedImage = fakeImage("gc");

  sandbox.setup();
  // p5.play would have sized these from the real artwork.
  sandbox.trex.addAnimation("running", fakeImage("trex", 88, 94));
  sandbox.trex.scale = 0.5;
  return sandbox;
}

function frames(s, n, ms) {
  for (let i = 0; i < n; i++) {
    clock += ms === undefined ? 16 : ms;
    s.draw();
    freshKeys.clear();
  }
}

// ---------------------------------------------------------------------------
console.log("--- single player ---");
{
  const s = load();
  check("starts on the menu", s.gameState === s.MENU);

  s.menuSinglePlayerRequested = true;
  frames(s, 1);
  check("single player starts a run", s.gameState === s.PLAY);

  frames(s, 200);
  check("run survives 200 frames", s.gameState === s.PLAY);
  check("score climbs", s.score > 0);
  check("obstacles spawn", s.obstaclesGroup.length > 0);

  // Force a crash.
  s.trexHitsAnyObstacle = () => true;
  frames(s, 1);
  check("collision ends the run", s.gameState === s.END);

  s.trexHitsAnyObstacle = () => false;
  s.restartRequested = true;
  frames(s, 1);
  check("restart begins a new run", s.gameState === s.PLAY);
  check("restart clears the score", s.score < 5);

  s.trexHitsAnyObstacle = () => true;
  frames(s, 1);
  s.trexHitsAnyObstacle = () => false;
  s.endMenuRequested = true;
  frames(s, 1);
  check("menu button returns to the menu", s.gameState === s.MENU);
}

// ---------------------------------------------------------------------------
console.log("");
console.log("--- multiplayer race ---");
{
  const s = load();
  sentMessages.length = 0;

  s.menuMultiplayerRequested = true;
  frames(s, 1);
  check("reaches the multiplayer menu", s.gameState === s.MULTIPLAYER_MENU);

  s.multiplayerCreateRequested = true;
  frames(s, 1);
  check("create room opens a socket", s.mpSocket !== null);
  s.mpSocket.onopen();
  check("create is sent", sentMessages.some((m) => m.type === "create"));

  s.mpSocket.onmessage({ data: JSON.stringify({ type: "created", room: "AB12" }) });
  frames(s, 1);
  check("waiting screen shows the code", s.mpRoomCode === "AB12");

  s.mpSocket.onmessage({ data: JSON.stringify({ type: "start", seed: 777, countdownMs: 3000 }) });
  check("start enters the countdown", s.gameState === s.MULTIPLAYER_COUNTDOWN);

  frames(s, 10);
  check("countdown holds before its time", s.gameState === s.MULTIPLAYER_COUNTDOWN);

  clock += 3100;
  frames(s, 1);
  check("countdown starts the race", s.gameState === s.PLAY && s.mpIsRacing === true);

  const seedUsed = s.obstacleStream !== null;
  frames(s, 200);
  check("race survives 200 frames", s.gameState === s.PLAY);
  check("state is sent to the opponent", sentMessages.some((m) => m.type === "state"));

  // Opponent reports in; the ghost should track them.
  s.mpSocket.onmessage({ data: JSON.stringify({ type: "opponent_state", y: 120, crouching: false, dead: false, score: 50 }) });
  frames(s, 5);
  check("ghost position is tracked", s.mpGhostY !== null);

  // Pause must not work mid-race.
  heldKeys.add("p"); freshKeys.add("p");
  frames(s, 1);
  heldKeys.delete("p");
  check("pause is refused during a race", s.gameState === s.PLAY);

  // Crash -> result screen, not game over.
  s.trexHitsAnyObstacle = () => true;
  frames(s, 1);
  s.trexHitsAnyObstacle = () => false;
  check("race crash goes to the result", s.gameState === s.MULTIPLAYER_RESULT);
  check("finished score is reported", sentMessages.some((m) => m.type === "finished"));

  frames(s, 30);
  check("result waits for the opponent", s.gameState === s.MULTIPLAYER_RESULT && !s.mpOpponentFinished);

  s.mpSocket.onmessage({ data: JSON.stringify({ type: "opponent_finished", score: 1 }) });
  frames(s, 5);
  check("result survives with both scores", s.gameState === s.MULTIPLAYER_RESULT);
  check("winner decided on score", s.mpSelfScore > s.mpOpponentScore);

  // Rematch round trip.
  sentMessages.length = 0;
  s.multiplayerRematchRequested = true;
  frames(s, 1);
  check("rematch is requested", sentMessages.some((m) => m.type === "rematch"));

  s.mpSocket.onmessage({ data: JSON.stringify({ type: "start", seed: 999, countdownMs: 3000 }) });
  check("rematch re-enters the countdown", s.gameState === s.MULTIPLAYER_COUNTDOWN);
  check("rematch clears the old result", s.mpSelfFinished === false && s.mpOpponentScore === null);

  clock += 3100;
  frames(s, 50);
  check("rematch race runs", s.gameState === s.PLAY && s.mpIsRacing);
}

// ---------------------------------------------------------------------------
console.log("");
console.log("--- leaving a race and going solo ---");
{
  const s = load();
  s.menuMultiplayerRequested = true; frames(s, 1);
  s.multiplayerCreateRequested = true; frames(s, 1);
  s.mpSocket.onopen();
  s.mpSocket.onmessage({ data: JSON.stringify({ type: "created", room: "ZZ99" }) });
  s.mpSocket.onmessage({ data: JSON.stringify({ type: "start", seed: 4242, countdownMs: 3000 }) });
  clock += 3100; frames(s, 1);
  check("race running", s.mpIsRacing === true);

  s.trexHitsAnyObstacle = () => true; frames(s, 1); s.trexHitsAnyObstacle = () => false;
  s.multiplayerLeaveRequested = true;
  frames(s, 1);
  check("leaving a race reaches the menu", s.gameState === s.MENU);
  check("race state is cleared", s.mpIsRacing === false && s.mpSeed === null);

  // The next solo run must NOT replay the race's course.
  const raceSeedCourse = s.obstaclesSpawned;
  s.menuSinglePlayerRequested = true;
  frames(s, 1);
  check("solo run starts after a race", s.gameState === s.PLAY);
  frames(s, 300);
  check("solo run spawns its own obstacles", s.obstaclesGroup.length > 0);
  check("pause works again outside a race", (() => {
    heldKeys.add("p"); freshKeys.add("p"); frames(s, 1); heldKeys.delete("p");
    const paused = s.gameState === s.PAUSED;
    heldKeys.add("p"); freshKeys.add("p"); frames(s, 1); heldKeys.delete("p");
    return paused;
  })());
}

// ---------------------------------------------------------------------------
console.log("");
console.log("--- adversarial paths ---");

function startedRace(seed) {
  const s = load();
  s.menuMultiplayerRequested = true; frames(s, 1);
  s.multiplayerCreateRequested = true; frames(s, 1);
  s.mpSocket.onopen();
  s.mpSocket.onmessage({ data: JSON.stringify({ type: "created", room: "QQ11" }) });
  s.mpSocket.onmessage({ data: JSON.stringify({ type: "start", seed: seed, countdownMs: 3000 }) });
  clock += 3100; frames(s, 2);
  return s;
}

// Opponent crashes first; you keep running and must still be racing.
{
  const s = startedRace(11);
  s.mpSocket.onmessage({ data: JSON.stringify({ type: "opponent_finished", score: 5 }) });
  frames(s, 60);
  check("you keep racing after they crash", s.gameState === s.PLAY && s.mpIsRacing);
  check("their crash raises a banner", s.mpOpponentGoneBannerUntil > 0);
  const scoreAtCrash = Math.floor(s.score);
  s.trexHitsAnyObstacle = () => true; frames(s, 1); s.trexHitsAnyObstacle = () => false;
  check("final score is the score you crashed on", s.mpSelfScore === scoreAtCrash, "got " + s.mpSelfScore + " want " + scoreAtCrash);
  check("you outscored them, so you win", s.mpSelfScore > s.mpOpponentScore, s.mpSelfScore + " vs " + s.mpOpponentScore);
}

// Opponent quits mid-run: forfeit, and you still get a result.
{
  const s = startedRace(12);
  s.mpSocket.onmessage({ data: JSON.stringify({ type: "opponent_left" }) });
  frames(s, 40);
  check("forfeit leaves you racing", s.gameState === s.PLAY);
  check("forfeit is recorded", s.mpOpponentLeft === true);
  s.trexHitsAnyObstacle = () => true; frames(s, 1); s.trexHitsAnyObstacle = () => false;
  frames(s, 5);
  check("forfeit still reaches a result", s.gameState === s.MULTIPLAYER_RESULT);
  check("no rematch offered after a forfeit", s.canRematch() === false);
}

// Socket dies mid-race.
{
  const s = startedRace(13);
  frames(s, 60);
  s.mpSocket.onclose();
  frames(s, 5);
  check("dropped socket ends the race", s.gameState === s.MULTIPLAYER_RESULT);
  check("dropped socket is reported", s.mpConnectionLost === true);
  check("no rematch offered after a drop", s.canRematch() === false);
  s.multiplayerLeaveRequested = true; frames(s, 1);
  check("can still get back to the menu", s.gameState === s.MENU);
}

// Joining a room that does not exist.
{
  const s = load();
  s.menuMultiplayerRequested = true; frames(s, 1);
  s.multiplayerJoinRequested = true; frames(s, 1);
  s.multiplayerJoinSubmitRequested = true;
  s.roomCodeInputElt = { value: "NOPE", style: {}, focus: noop, blur: noop };
  frames(s, 1);
  s.mpSocket.onopen();
  s.mpSocket.onmessage({ data: JSON.stringify({ type: "error", message: "Room not found." }) });
  frames(s, 2);
  check("bad room code returns to mp menu", s.gameState === s.MULTIPLAYER_MENU);
  check("bad room code explains itself", s.mpConnectionMessage === "Room not found.");
}

// Repeated rematch clicks must not queue up duplicate requests.
{
  const s = startedRace(14);
  s.trexHitsAnyObstacle = () => true; frames(s, 1); s.trexHitsAnyObstacle = () => false;
  s.mpSocket.onmessage({ data: JSON.stringify({ type: "opponent_finished", score: 5 }) });
  sentMessages.length = 0;
  for (let i = 0; i < 6; i++) { s.multiplayerRematchRequested = true; frames(s, 1); }
  check("repeat rematch clicks send once", sentMessages.filter((m) => m.type === "rematch").length === 1);
}

// Night mode: run long enough to cross into night and draw the outlines.
{
  const s = load();
  s.menuSinglePlayerRequested = true; frames(s, 1);
  frames(s, 2000);
  check("night mode is reached", s.score > 700);
  check("night fade engaged", s.nightAmount > 0);
  check("game still running at night", s.gameState === s.PLAY);
}

// Arriving on a shared room link goes straight into the room.
{
  const saved = fs.readFileSync(path.join(__dirname, "..", "sketch.js"), "utf8");
  const sandbox = load.__withSearch ? null : null;
  // Reload with a ?room= address.
  const s = (function () {
    const orig = load;
    return (function loadWithRoom() {
      const ctx = orig();
      return ctx;
    })();
  })();
  // Simulate the invite by rerunning setup with a room in the address.
  s.window.location.search = "?room=AB12";
  s.setup();
  check("invite link auto-joins the room", s.gameState === s.MULTIPLAYER_WAITING && s.mpRoomCode === "AB12");
}

console.log("");
console.log(failures === 0 ? "ALL PASS" : failures + " FAILED");
process.exit(failures === 0 ? 0 : 1);
