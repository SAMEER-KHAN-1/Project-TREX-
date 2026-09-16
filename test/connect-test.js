// A connection that never opens must explain itself and eventually give up,
// rather than sitting on "Connecting..." forever.
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const SRC = fs.readFileSync(path.join(__dirname, "..", "sketch.js"), "utf8");

const noop = () => {};
let failures = 0;
function check(label, ok, extra) { if (!ok) failures++; console.log(label.padEnd(50), ok ? "PASS" : "FAIL " + (extra || "")); }

let clock = 0;
function fakeImage(n, w, h) { const W = w || 88, H = h || 94; return { __name: n, width: W, height: H, pixels: new Array(W * H * 4).fill(255), loadPixels: noop }; }
function makeSprite(x, y, w, h) {
  return { x, y, width: w, height: h, scale: 1, depth: 0, visible: true, velocityX: 0, velocityY: 0, lifetime: 0, animation: null,
    addImage(i) { this.animation = { getFrameImage: () => i }; }, addAnimation(n, f) { this.animation = { getFrameImage: () => f, frameDelay: 0 }; },
    changeAnimation: noop, setCollider: noop, collide: () => true, remove() {}, _getScaleX() { return this.scale; }, _getScaleY() { return this.scale; } };
}
function makeGroup() { const g = []; g.add = function (s) { this.push(s); }; g.removeSprites = function () { this.length = 0; }; g.setVelocityXEach = noop; return g; }

// A socket that connects and simply never opens - exactly a sleeping instance.
function StalledSocket() { this.readyState = 0; this.send = noop; this.close = noop; }
StalledSocket.OPEN = 1;

const s = {
  window: { location: { search: "", protocol: "http:", host: "h:8080", origin: "http://h:8080", pathname: "/" }, addEventListener: noop, isSecureContext: false },
  navigator: {}, Math, JSON, Number, String, Array, Object, Infinity, console, RegExp, Set,
  document: { addEventListener: noop, querySelector: () => ({ style: {}, addEventListener: noop, getBoundingClientRect: () => ({ left: 0, top: 0, width: 600, height: 200 }) }), createElement: () => ({ style: {}, addEventListener: noop, select: noop, focus: noop, blur: noop, value: "" }), body: { appendChild: noop, removeChild: noop } },
  p5: { prototype: { _updateTouchCoords: noop }, instance: {} },
  WebSocket: StalledSocket, localStorage: {}, millis: () => clock,
  random: (a, b) => (a === undefined ? 0.5 : b === undefined ? 0.5 * a : a + 0.5 * (b - a)),
  constrain: (v, lo, hi) => Math.min(hi, Math.max(lo, v)),
  keyDown: () => false, keyWentDown: () => false,
  createCanvas: noop, resizeCanvas: noop, frameRate: noop, background: noop,
  push: noop, pop: noop, translate: noop, noStroke: noop, stroke: noop, strokeWeight: noop,
  fill: noop, rect: noop, ellipse: noop, textFont: noop, textAlign: noop, textSize: noop,
  image: noop, imageMode: noop, tint: noop, rectMode: noop, line: noop,
  drawSprites: noop, createSprite: makeSprite, Group: function () { return makeGroup(); },
  CENTER: "c", RIGHT: "r", TOP: "t", LEFT: "l", BOTTOM: "b", CORNER: "corner", CLOSE: "close",
  width: 600, height: 200, windowWidth: 1200, windowHeight: 400,
  createGraphics: (w, h) => ({ width: w, height: h, pixels: [60, 60, 60, 255], clear: noop, image: noop, loadPixels: noop, updatePixels: noop, noStroke: noop, fill: noop, ellipse: noop, triangle: noop, beginShape: noop, vertex: noop, endShape: noop, stroke: noop, strokeWeight: noop, line: noop, get: () => fakeImage("white", w, h) }),
};
const drawnText = [];
s.text = (str) => drawnText.push(String(str));
s.globalThis = s;
vm.createContext(s);
vm.runInContext(SRC, s);
s.trex_running = {}; s.trex_collided = {};
s.groundImage = fakeImage("g", 2377, 12); s.cloudImage = fakeImage("c", 92, 27);
for (let i = 1; i <= 6; i++) s["obstacle" + i] = fakeImage("o" + i, 50, 100);
s.gameOverImg = fakeImage("go", 381, 21); s.restartImg = fakeImage("re", 75, 64);
s.ghostRunFrames = [fakeImage("r0")]; s.ghostCollidedImage = fakeImage("gc");
s.setup();
s.trex.addAnimation("running", fakeImage("t", 89, 94)); s.trex.scale = 0.5;

function frame() { clock += 100; drawnText.length = 0; s.draw(); }
const showed = (needle) => drawnText.some((t) => t.indexOf(needle) >= 0);

s.gameState = s.MULTIPLAYER_MENU;
s.multiplayerCreateRequested = true;
frame();
check("create opens a socket", s.mpSocket !== null);
check("lobby is shown", s.gameState === s.MULTIPLAYER_WAITING);
//the state flips at the end of the menu branch, so the lobby first draws next frame
frame();
check("says it is connecting", showed("CONNECTING"));
check("no waking note straight away", !showed("WAKING UP"));

// A short wait should stay quiet - most connects are instant.
clock += 2000; frame();
check("still quiet after 2s", !showed("WAKING UP"));

// Past that, it should explain itself rather than look stuck.
clock += 3000; frame();
check("explains the wait after ~5s", showed("WAKING UP"));
check("says how long it may take", showed("UP TO A MINUTE"));
check("has not given up yet", s.gameState === s.MULTIPLAYER_WAITING);

// ...and eventually give up rather than hang forever.
clock += 60000; frame();
check("gives up after the timeout", s.gameState === s.MULTIPLAYER_MENU);
check("explains why", /Couldn't reach the server/.test(s.mpConnectionMessage || ""), s.mpConnectionMessage);
check("socket is released", s.mpSocket === null);

// A connection that DOES open must never trip the timeout.
s.gameState = s.MULTIPLAYER_MENU;
s.multiplayerCreateRequested = true;
frame();
s.mpSocket.readyState = 1;
s.mpSocket.onopen();
s.mpSocket.onmessage({ data: JSON.stringify({ type: "created", room: "AB12" }) });
clock += 120000; frame();
check("an open lobby never times out", s.gameState === s.MULTIPLAYER_WAITING);
check("open lobby shows no waking note", !showed("WAKING UP"));

console.log("");
console.log(failures === 0 ? "ALL PASS" : failures + " FAILED");
process.exit(failures === 0 ? 0 : 1);
