// Button hover / press / cursor behaviour, driven through the real draw loop.
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const SRC = fs.readFileSync(path.join(__dirname, "..", "sketch.js"), "utf8");

const noop = () => {};
let failures = 0;
function check(label, ok, extra) { if (!ok) failures++; console.log(label.padEnd(52), ok ? "PASS" : "FAIL " + (extra || "")); }

let clock = 0;
const rects = [];
const canvasStyle = {};
const listeners = {};

function fakeImage(name, w, h) {
  const width = w || 88, height = h || 94;
  return { __name: name, width, height, pixels: new Array(width * height * 4).fill(255), loadPixels: noop };
}
function makeSprite(x, y, w, h) {
  return {
    x, y, width: w, height: h, scale: 1, depth: 0, visible: true,
    velocityX: 0, velocityY: 0, lifetime: 0, animation: null, baseVelocityX: 0,
    //p5.play's addImage takes either (image) or (label, image) - the ground
    //is added with a label, and reading the label as the image left the
    //sprite's width NaN, which no wrap-around can be measured against
    addImage(a, b) { const i = b || a; this.animation = { getFrameImage: () => i }; this.width = i.width; this.height = i.height; },
    addAnimation(n, f) { this.animation = { getFrameImage: () => f, frameDelay: 0 }; this.width = f.width; this.height = f.height; },
    changeAnimation: noop, setCollider: noop, collide: () => true, remove() {},
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

const sandbox = {
  window: { location: { search: "", protocol: "http:", host: "h:8080", origin: "http://h:8080", pathname: "/" }, addEventListener: noop, isSecureContext: false },
  navigator: {},
  Math, JSON, Number, String, Array, Object, Infinity, console, RegExp, Set,
  document: {
    addEventListener: noop,
    querySelector: () => ({
      style: canvasStyle,
      addEventListener: (n, fn) => { listeners[n] = fn; },
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 600, height: 200 }),
    }),
    createElement: () => ({ style: {}, addEventListener: noop, select: noop, focus: noop, blur: noop }),
    body: { appendChild: noop, removeChild: noop },
  },
  p5: { prototype: { _updateTouchCoords: noop }, instance: {} },
  localStorage: {}, millis: () => clock,
  random: (a, b) => (a === undefined ? 0.5 : b === undefined ? 0.5 * a : a + 0.5 * (b - a)),
  constrain: (v, lo, hi) => Math.min(hi, Math.max(lo, v)),
  keyDown: () => false, keyWentDown: () => false,
  createCanvas: noop, resizeCanvas: noop, frameRate: noop, background: noop,
  push: noop, pop: noop, translate: noop, noStroke: noop, stroke: noop, strokeWeight: noop,
  fill: (...a) => rects.push({ kind: "fill", a }),
  rect: (x, y, w, h, r) => rects.push({ kind: "rect", x, y, w, h, r, fill: lastFill() }),
  ellipse: noop, text: noop, textFont: noop, textAlign: noop, textSize: noop,
  image: noop, imageMode: noop, tint: noop, rectMode: noop, line: noop,
  drawSprites: noop, createSprite: makeSprite, Group: function () { return makeGroup(); },
  CENTER: "c", RIGHT: "r", TOP: "t", LEFT: "l", BOTTOM: "b", CORNER: "corner", CLOSE: "close",
  width: 600, height: 200, windowWidth: 1200, windowHeight: 400,
  createGraphics: (w, h) => ({ width: w, height: h, pixels: [60, 60, 60, 255], clear: noop, image: noop, loadPixels: noop, updatePixels: noop, noStroke: noop, fill: noop, ellipse: noop, triangle: noop, beginShape: noop, vertex: noop, endShape: noop, stroke: noop, strokeWeight: noop, line: noop, get: () => fakeImage("white", w, h) }),
};
function lastFill() {
  for (let i = rects.length - 1; i >= 0; i--) if (rects[i].kind === "fill") return rects[i].a;
  return null;
}
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(SRC, sandbox);
sandbox.trex_running = { __name: "running" }; sandbox.trex_collided = { __name: "collided" };
sandbox.groundImage = fakeImage("ground", 2377, 12); sandbox.cloudImage = fakeImage("cloud", 92, 27);
for (let i = 1; i <= 6; i++) sandbox["obstacle" + i] = fakeImage("cactus" + i, 50, 100);
sandbox.gameOverImg = fakeImage("go", 381, 21); sandbox.restartImg = fakeImage("re", 75, 64);
sandbox.ghostRunFrames = [fakeImage("r0")]; sandbox.ghostCollidedImage = fakeImage("gc");
sandbox.setup();
sandbox.trex.addAnimation("running", fakeImage("trex", 89, 94));
sandbox.trex.scale = 0.5;

function frame() { clock += 16; rects.length = 0; sandbox.draw(); }
// The canvas is 600x200 here, so strip coords and client coords line up.
const at = (b) => ({ clientX: b.x, clientY: b.y, pointerType: "mouse" });

const BTN = sandbox.MENU_SINGLE_PLAYER_BUTTON;
const OTHER = sandbox.MENU_MULTIPLAYER_BUTTON;

// Slab colour for a given button, taken from what was actually drawn.
// Matched on y as well as x: buttons stacked on a menu share both x and width,
// so x alone cannot tell them apart. The shadow is the black rect at the same
// spot; the slab is the coloured one.
function slabFillFor(button) {
  const near = rects.filter((r) =>
    r.kind === "rect" && r.w === button.w &&
    Math.abs(r.x - button.x) < 0.01 &&
    Math.abs(r.y - button.y) <= sandbox.BUTTON_LIFT + 0.01);
  const slab = near.find((r) => r.fill && !(r.fill.length === 4 && r.fill[0] === 0 && r.fill[1] === 0 && r.fill[2] === 0));
  return slab ? slab.fill : null;
}

frame();
const idle = slabFillFor(BTN);
check("button draws with the idle colour", JSON.stringify(idle) === JSON.stringify(sandbox.BUTTON_PRIMARY.idle), JSON.stringify(idle));
check("cursor is default with no hover", canvasStyle.cursor === "default", canvasStyle.cursor);

listeners.pointermove(at(BTN));
frame();
check("hovering lightens the button", JSON.stringify(slabFillFor(BTN)) === JSON.stringify(sandbox.BUTTON_PRIMARY.hover));
check("hovering sets a pointer cursor", canvasStyle.cursor === "pointer");
check("the other button stays idle", JSON.stringify(slabFillFor(OTHER)) === JSON.stringify(sandbox.BUTTON_PRIMARY.idle));

listeners.pointerdown(at(BTN));
check("pressing records the button", sandbox.pressedButton === BTN);
sandbox.gameState = sandbox.MENU;   // the click also starts a run; stay on the menu to observe
sandbox.menuSinglePlayerRequested = false;
frame();
check("pressed button darkens", JSON.stringify(slabFillFor(BTN)) === JSON.stringify(sandbox.BUTTON_PRIMARY.press));

// Releasing anywhere at all must clear the press, or it sticks down forever.
sandbox.onPointerRelease();
frame();
check("release clears the pressed state", sandbox.pressedButton === null);

listeners.pointerleave();
frame();
check("leaving the canvas clears hover", JSON.stringify(slabFillFor(BTN)) === JSON.stringify(sandbox.BUTTON_PRIMARY.idle));
check("leaving restores the default cursor", canvasStyle.cursor === "default");

// Touch must never leave a button looking hovered.
listeners.pointermove({ clientX: BTN.x, clientY: BTN.y, pointerType: "touch" });
frame();
check("touch does not produce a hover", JSON.stringify(slabFillFor(BTN)) === JSON.stringify(sandbox.BUTTON_PRIMARY.idle));

// Every screen's button list must match what that screen draws, or presses
// land on buttons that aren't there.
const screens = [
  ["MENU", sandbox.MENU], ["MULTIPLAYER_MENU", sandbox.MULTIPLAYER_MENU],
  ["MULTIPLAYER_JOIN_ENTRY", sandbox.MULTIPLAYER_JOIN_ENTRY],
  ["MULTIPLAYER_WAITING", sandbox.MULTIPLAYER_WAITING],
  ["MULTIPLAYER_COUNTDOWN", sandbox.MULTIPLAYER_COUNTDOWN],
  ["MULTIPLAYER_RESULT", sandbox.MULTIPLAYER_RESULT],
  ["END", sandbox.END],
];
let listsMatch = true;
const mismatches = [];
for (const [name, state] of screens) {
  sandbox.gameState = state;
  sandbox.mpRoomCode = "AB12";
  frame();
  const declared = sandbox.buttonsOnScreen();
  // A button is "drawn" if a slab of its width appeared centred on its x.
  for (const b of declared) {
    const found = rects.some((r) => r.kind === "rect" && Math.abs(r.x - b.x) < 0.01 && r.w === b.w);
    if (!found) { listsMatch = false; mismatches.push(name + " declares a button it never draws"); }
  }
  if (declared.length === 0 && state !== sandbox.PLAY) {
    // fine - some screens legitimately have none
  }
}
check("declared buttons match drawn buttons", listsMatch, mismatches.join("; "));

// Overlays that only appear in a particular state, and so are easy to ship
// broken: every p5 constant and call in them must actually exist.
function drawsWithoutThrowing(label, setUp) {
  try {
    setUp();
    frame();
    check(label, true);
  } catch (e) {
    check(label, false, e.message);
  }
}

drawsWithoutThrowing("muted badge draws", () => {
  sandbox.gameState = sandbox.PLAY;
  sandbox.soundMuted = true;
});
drawsWithoutThrowing("paused overlay draws", () => {
  sandbox.gameState = sandbox.PAUSED;
});
drawsWithoutThrowing("muted badge draws at night", () => {
  sandbox.gameState = sandbox.PLAY;
  sandbox.nightAmount = 1;
});
sandbox.soundMuted = false;
sandbox.nightAmount = 0;

// The whole UI is pixel-art arcade: square corners, ink keylines. A rounded
// rect anywhere in it is a web form control wearing the wrong clothes, and it
// only takes one to make the screen look like a mistake rather than a style.
{
  const rounded = [];
  for (const [name, state] of screens) {
    sandbox.gameState = state;
    sandbox.mpRoomCode = "AB12";
    frame();
    for (const r of rects) {
      if (r.kind === "rect" && r.r !== undefined) rounded.push(name + " @" + r.x + "," + r.y);
    }
  }
  check("no rounded corners anywhere in the UI", rounded.length === 0, rounded.join("; "));
}

// Every card is the same plate: an ink keyline rect with the body rect drawn
// inside it, 6px smaller in both directions. Screens used to roll their own,
// each with a different radius and a different grey.
{
  const missingFrame = [];
  const cards = [
    ["multiplayer menu", sandbox.MULTIPLAYER_MENU, sandbox.OVERLAY_PANEL.w, sandbox.OVERLAY_PANEL.h],
    ["paused", sandbox.PAUSED, 260, 74],
  ];
  for (const [name, state, w, h] of cards) {
    sandbox.gameState = state;
    frame();
    const body = rects.some((r) => r.kind === "rect" && r.w === w && r.h === h);
    const frameRect = rects.some((r) => r.kind === "rect" && r.w === w + 6 && r.h === h + 6);
    if (!body || !frameRect) missingFrame.push(name);
  }
  check("every card is drawn as a keylined plate", missingFrame.length === 0, missingFrame.join("; "));
}

// The menu is an attract screen: the world runs behind it. It must run
// without touching anything a real run counts, and it must stop the moment
// the player leaves for a screen that shows a still world.
{
  sandbox.gameState = sandbox.MENU;
  sandbox.score = 0;
  sandbox.distanceTravelled = 0;
  sandbox.ground.x = 500;
  frame();
  check("menu scrolls the ground", sandbox.ground.velocityX < 0, String(sandbox.ground.velocityX));
  check("menu scrolls slower than a run opens at",
    Math.abs(sandbox.ground.velocityX) < sandbox.BASE_SPEED, String(sandbox.ground.velocityX));
  frame(); frame();
  check("menu costs the run no score", sandbox.score === 0, String(sandbox.score));
  check("menu costs the run no distance", sandbox.distanceTravelled === 0, String(sandbox.distanceTravelled));
  check("menu spawns no obstacles", sandbox.obstaclesGroup.length === 0, String(sandbox.obstaclesGroup.length));

  //the ground wraps rather than scrolling off to the left forever
  sandbox.ground.x = -1;
  frame();
  check("menu ground wraps around", sandbox.ground.x > 0, String(sandbox.ground.x));

  sandbox.menuMultiplayerRequested = true;
  frame();
  check("leaving the menu reaches the lobby", sandbox.gameState === sandbox.MULTIPLAYER_MENU);
  check("leaving the menu stops the ground", sandbox.ground.velocityX === 0, String(sandbox.ground.velocityX));
  frame();
  check("the lobby world stays still", sandbox.ground.velocityX === 0, String(sandbox.ground.velocityX));
}

// The attract prompt blinks. Both phases have to actually occur, and neither
// may be fully transparent - a prompt that disappears outright on a screen
// this small reads as a fault rather than as a blink.
{
  const phases = new Set();
  for (let t = 0; t < sandbox.MENU_BLINK_MS * 2; t += 50) { clock = t; phases.add(sandbox.menuBlinkAlpha()); }
  check("attract prompt blinks between two shades", phases.size === 2, [...phases].join(","));
  check("attract prompt never blinks fully out", [...phases].every((a) => a > 0), [...phases].join(","));
}

// The waiting dots have to actually cycle, or they are just a static string.
const seen = new Set();
for (let t = 0; t < 2000; t += 100) { clock = t; seen.add(sandbox.waitingDots()); }
check("waiting dots animate", seen.size === 4, [...seen].map((s) => '"' + s + '"').join(","));

// Every overlay screen must render without throwing, in each of its variants.
const variants = [
  ["multiplayer menu", () => { sandbox.gameState = sandbox.MULTIPLAYER_MENU; sandbox.mpConnectionMessage = "Room not found."; }],
  ["waiting, connecting", () => { sandbox.gameState = sandbox.MULTIPLAYER_WAITING; sandbox.mpRoomCode = null; }],
  ["waiting, with a code", () => { sandbox.mpRoomCode = "AB12"; }],
  ["join entry", () => { sandbox.gameState = sandbox.MULTIPLAYER_JOIN_ENTRY; }],
  ["countdown", () => { sandbox.gameState = sandbox.MULTIPLAYER_COUNTDOWN; sandbox.mpRaceStartMillis = clock + 2500; }],
  ["result, waiting", () => { sandbox.gameState = sandbox.MULTIPLAYER_RESULT; sandbox.mpOpponentFinished = false; }],
  ["result, win", () => { sandbox.mpOpponentFinished = true; sandbox.mpSelfScore = 900; sandbox.mpOpponentScore = 400; }],
  ["result, loss", () => { sandbox.mpSelfScore = 100; sandbox.mpOpponentScore = 400; }],
  ["result, dead heat", () => { sandbox.mpSelfScore = 400; sandbox.mpOpponentScore = 400; }],
  ["result, forfeit", () => { sandbox.mpOpponentLeft = true; sandbox.mpOpponentScore = null; }],
  ["result, connection lost", () => { sandbox.mpOpponentLeft = false; sandbox.mpConnectionLost = true; }],
];
for (const [label, setUp] of variants) drawsWithoutThrowing(label, setUp);



// --- Controls hint: must appear for a newcomer and vanish once they jump.
(function () {
  sandbox.gameState = sandbox.PLAY;
  sandbox.playerHasJumped = false;
  sandbox.runStartedMillis = clock;
  check("hint is visible at the start of a run", sandbox.controlsHintAlpha() === 1);

  clock += 5500;
  const fading = sandbox.controlsHintAlpha();
  check("hint fades before it disappears", fading > 0 && fading < 1, String(fading));

  clock += 1000;
  check("hint times out as a backstop", sandbox.controlsHintAlpha() === 0);

  // A player who jumps immediately should not keep seeing it.
  sandbox.runStartedMillis = clock;
  check("hint returns for a fresh run", sandbox.controlsHintAlpha() === 1);
  sandbox.playerHasJumped = true;
  check("jumping dismisses the hint at once", sandbox.controlsHintAlpha() === 0);

  // ...and it must stay dismissed on later runs, not nag every time.
  sandbox.runStartedMillis = clock;
  check("hint stays gone on later runs", sandbox.controlsHintAlpha() === 0);

  sandbox.playerHasJumped = false;
  sandbox.runStartedMillis = clock;
  try { frame(); check("hint renders without throwing", true); }
  catch (e) { check("hint renders without throwing", false, e.message); }
  sandbox.playerHasJumped = true;
})();

console.log("");
console.log(failures === 0 ? "ALL PASS" : failures + " FAILED");
process.exit(failures === 0 ? 0 : 1);
