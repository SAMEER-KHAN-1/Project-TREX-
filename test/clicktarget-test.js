// Clicks must land on the button the player can see.
//
// The hit test subtracts the gameplay strip's offset and the drawing adds it,
// so any disagreement between the two shifts every hit box on the screen up or
// down by exactly that difference - the symptom being buttons that only
// respond to a click somewhere above where they are drawn. These cases cover
// the ways the two can drift apart: a viewport change the browser never
// announced, and one announced between the frame the player is looking at and
// the tap they aim at it.
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const SRC = fs.readFileSync(path.join(__dirname, "..", "sketch.js"), "utf8");

const noop = () => {};
let failures = 0;
function check(label, ok, extra) { if (!ok) failures++; console.log("  " + label.padEnd(50), ok ? "PASS" : "FAIL " + (extra || "")); }

let clock = 0;
const listeners = {};
const canvasStyle = {};
let connected = true;
// The box the browser reports for the canvas. Mirrors whatever fillScreen()
// last wrote, centred in the window the way style.css centres it.
let cssBox = { left: 0, top: 0, width: 600, height: 200 };

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

// Records the translate the frame was painted with, so a test can aim at where
// a button really ended up rather than at where it was supposed to.
let paintedOffsetY = 0;

const sandbox = {
  window: { location: { search: "", protocol: "http:", host: "h:8080", origin: "http://h:8080", pathname: "/" }, addEventListener: noop, isSecureContext: false, innerWidth: 1200, innerHeight: 400 },
  navigator: {},
  Math, JSON, Number, String, Array, Object, Infinity, console, RegExp, Set,
  document: {
    addEventListener: noop,
    querySelector: () => ({
      style: canvasStyle,
      get isConnected() { return connected; },
      addEventListener: (n, fn) => { listeners[n] = fn; },
      getBoundingClientRect: () => cssBox,
    }),
    createElement: () => ({ style: {}, addEventListener: noop, select: noop, focus: noop, blur: noop, value: "" }),
    body: { appendChild: noop, removeChild: noop },
  },
  p5: { prototype: { _updateTouchCoords: noop }, instance: {} },
  localStorage: {}, millis: () => clock,
  random: (a, b) => (a === undefined ? 0.5 : b === undefined ? 0.5 * a : a + 0.5 * (b - a)),
  constrain: (v, lo, hi) => Math.min(hi, Math.max(lo, v)),
  keyDown: () => false, keyWentDown: () => false,
  createCanvas: (w, h) => { sandbox.width = w; sandbox.height = h; },
  resizeCanvas: (w, h) => { sandbox.width = w; sandbox.height = h; },
  frameRate: noop, background: noop,
  push: noop, pop: noop,
  translate: (x, y) => { paintedOffsetY = y; },
  noStroke: noop, stroke: noop, strokeWeight: noop,
  fill: noop, rect: noop, ellipse: noop, text: noop, textFont: noop, textAlign: noop,
  textSize: noop, image: noop, imageMode: noop, tint: noop, rectMode: noop, line: noop,
  drawSprites: noop, createSprite: makeSprite, Group: function () { return makeGroup(); },
  CENTER: "c", RIGHT: "r", TOP: "t", LEFT: "l", BOTTOM: "b", CORNER: "corner", CLOSE: "close",
  width: 600, height: 200, windowWidth: 1200, windowHeight: 400,
  createGraphics: (w, h) => ({ width: w, height: h, pixels: [60, 60, 60, 255], clear: noop, image: noop, loadPixels: noop, updatePixels: noop, noStroke: noop, fill: noop, ellipse: noop, triangle: noop, beginShape: noop, vertex: noop, endShape: noop, stroke: noop, strokeWeight: noop, line: noop, get: () => fakeImage("white", w, h) }),
};
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

// Re-measure the element the way a browser would once fillScreen() has written
// the new CSS size onto it: centred in the window, as style.css centres it.
function remeasure() {
  const w = parseFloat(canvasStyle.width);
  const h = parseFloat(canvasStyle.height);
  cssBox = {
    left: Math.round((sandbox.windowWidth - w) / 2),
    top: Math.round((sandbox.windowHeight - h) / 2),
    width: w, height: h,
  };
}
// Presses in these cases are only ever measuring where a hit lands, so the
// flags they set are dropped rather than acted on - left standing, the next
// draw() would consume one and walk the game off the screen under test.
const REQUEST_FLAGS = [
  "menuSinglePlayerRequested", "menuMultiplayerRequested", "menuBackRequested",
  "multiplayerCreateRequested", "multiplayerJoinRequested", "multiplayerJoinSubmitRequested",
  "multiplayerLeaveRequested", "multiplayerRematchRequested", "endMenuRequested",
  "restartRequested",
];
function clearRequests() { for (const f of REQUEST_FLAGS) sandbox[f] = false; }

function frame() { clearRequests(); clock += 16; sandbox.draw(); remeasure(); }

// A viewport change the browser DID announce.
function resizeTo(w, h) {
  sandbox.window.innerWidth = w; sandbox.window.innerHeight = h;
  sandbox.windowWidth = w; sandbox.windowHeight = h;
  sandbox.windowResized();
  remeasure();
}
// A viewport change the browser never announced - a coalesced fullscreen
// transition, a mobile URL bar sliding away, an orientation change on iOS.
// p5's own windowWidth/windowHeight are left behind exactly as they would be.
function silentResizeTo(w, h) {
  sandbox.window.innerWidth = w; sandbox.window.innerHeight = h;
}

// Aim a pointer at a point in the strip, using the offset the last painted
// frame actually used - which is what the player is looking at.
function aimAtPainted(x, y) {
  return {
    clientX: cssBox.left + x * (cssBox.width / sandbox.width),
    clientY: cssBox.top + (y + paintedOffsetY) * (cssBox.height / sandbox.height),
    pointerType: "mouse",
  };
}
function press(evt) {
  sandbox.pressedButton = null;
  listeners.pointerdown(evt);
  const hit = sandbox.pressedButton;
  clearRequests();
  return hit;
}

const SCREENS = [
  ["MENU", () => { sandbox.gameState = sandbox.MENU; }],
  ["MULTIPLAYER_MENU", () => { sandbox.gameState = sandbox.MULTIPLAYER_MENU; }],
  ["MULTIPLAYER_JOIN_ENTRY", () => { sandbox.gameState = sandbox.MULTIPLAYER_JOIN_ENTRY; }],
  ["MULTIPLAYER_WAITING", () => { sandbox.gameState = sandbox.MULTIPLAYER_WAITING; sandbox.mpRoomCode = "AB12"; }],
  ["END", () => { sandbox.gameState = sandbox.END; }],
];

// Every button, on every screen, at every shape - aimed at its centre and at
// the top and bottom edge of the slab the player can see.
console.log("every button hits where it is painted");
for (const [label, w, h] of [
  ["laptop    1440x900", 1440, 900],
  ["phone      390x844", 390, 844],
  ["landscape  844x390", 844, 390],
  ["ultrawide 2560x600", 2560, 600],
]) {
  resizeTo(w, h);
  const missed = [];
  for (const [name, enter] of SCREENS) {
    enter();
    frame();
    for (const b of sandbox.buttonsOnScreen()) {
      for (const [where, dy] of [["mid", 0], ["top", -b.h / 2 + 1], ["bot", b.h / 2 - 1]]) {
        if (press(aimAtPainted(b.x, b.y + dy)) !== b) missed.push(name + ":" + b.y + ":" + where);
      }
    }
  }
  check(label, missed.length === 0, missed.join(" "));
}

// A viewport change the browser never announced. Without a per-frame layout
// sync the canvas stays sized for a window that no longer exists.
console.log("");
console.log("viewport change with no resize event");
resizeTo(1440, 900);
sandbox.gameState = sandbox.MENU;
frame();
silentResizeTo(390, 844);
frame();
check("canvas followed the new viewport", sandbox.height === Math.round(600 * 844 / 390), String(sandbox.height));
{
  const missed = [];
  for (const b of sandbox.buttonsOnScreen()) {
    if (press(aimAtPainted(b.x, b.y)) !== b) missed.push(String(b.y));
  }
  check("buttons still hit where painted", missed.length === 0, "missed y=" + missed.join(","));
}

// A canvas p5 has replaced measures 0 in every direction; the handler must
// pick the live one up rather than turn every click into a miss.
console.log("");
console.log("canvas replaced underneath the handler");
resizeTo(1440, 900);
sandbox.gameState = sandbox.MENU;
frame();
connected = false;
const firstButton = sandbox.buttonsOnScreen()[0];
check("still hits after re-querying the canvas",
  press(aimAtPainted(firstButton.x, firstButton.y)) === firstButton);
connected = true;

// A degenerate box must not produce NaN coordinates, which compare false
// against everything and so hide the failure instead of showing it.
console.log("");
console.log("degenerate canvas box");
cssBox = { left: 0, top: 0, width: 0, height: 0 };
check("zero-sized canvas maps to null", sandbox.canvasPointerToGame({ clientX: 10, clientY: 10 }) === null);
cssBox = { left: 0, top: 0, width: NaN, height: NaN };
check("NaN-sized canvas maps to null", sandbox.canvasPointerToGame({ clientX: 10, clientY: 10 }) === null);

console.log("");
console.log(failures === 0 ? "ALL PASS" : failures + " FAILED");
process.exit(failures === 0 ? 0 : 1);
