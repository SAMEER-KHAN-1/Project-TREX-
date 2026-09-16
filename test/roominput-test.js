// The room code field is a real HTML <input> laid over the canvas, and it is
// the only screen a phone player cannot avoid - a code has to be typed in by
// hand. Two things about it were wrong on phones:
//
//   * its text scaled down to about 12px, and iOS Safari zooms the whole page
//     in when an input under 16px is focused (user-scalable=no does not stop
//     it), leaving the letterboxed canvas half off-screen with nowhere to
//     scroll back to;
//   * it was focused from the next animation frame rather than from the tap,
//     and a mobile browser only raises its keyboard for a focus() that happens
//     inside the gesture that asked for it.
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const SRC = fs.readFileSync(path.join(__dirname, "..", "sketch.js"), "utf8");

const noop = () => {};
let clock = 0;

// Real device shapes, in CSS pixels, portrait as a phone is actually held.
const DEVICES = [
  { name: "iPhone SE portrait", w: 375, h: 667 },
  { name: "iPhone 14 portrait", w: 390, h: 844 },
  { name: "iPhone 14 landscape", w: 844, h: 390 },
  { name: "Pixel 7 portrait", w: 412, h: 915 },
  { name: "small android portrait", w: 320, h: 568 },
  { name: "iPad portrait", w: 768, h: 1024 },
  { name: "laptop", w: 1440, h: 900 },
];

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

function load() {
  const canvasListeners = {};
  // A stand-in for the real <input>, recording focus calls so the test can ask
  // WHEN it was focused, not just whether.
  const input = {
    style: {}, value: "", focusCount: 0, blurCount: 0,
    addEventListener: (n, fn) => { (input.handlers[n] = input.handlers[n] || []).push(fn); },
    handlers: {},
    focus() { input.focusCount++; },
    blur() { input.blurCount++; },
    select: noop,
  };
  const canvasStyle = {};
  const sandbox = {
    window: { location: { search: "", protocol: "http:", host: "h:8080", origin: "http://h:8080", pathname: "/" }, addEventListener: noop, isSecureContext: false },
    navigator: {},
    Math, JSON, Number, String, Array, Object, Infinity, console, RegExp, Set,
    document: {
      addEventListener: noop,
      querySelector: () => ({
        style: canvasStyle,
        addEventListener: (n, fn) => { canvasListeners[n] = fn; },
        getBoundingClientRect: () => sandbox.__canvasRect,
      }),
      createElement: () => input,
      body: { appendChild: noop, removeChild: noop },
    },
    p5: { prototype: { _updateTouchCoords: noop }, instance: {} },
    WebSocket: function () { this.readyState = 0; this.send = noop; this.close = noop; },
    localStorage: {}, millis: () => clock,
    random: (a, b) => (a === undefined ? 0.5 : b === undefined ? 0.5 * a : a + 0.5 * (b - a)),
    constrain: (v, lo, hi) => Math.min(hi, Math.max(lo, v)),
    keyDown: () => false, keyWentDown: () => false,
    createCanvas: (w, h) => { sandbox.width = w; sandbox.height = h; },
    resizeCanvas: (w, h) => { sandbox.width = w; sandbox.height = h; },
    frameRate: noop, background: noop,
    push: noop, pop: noop, translate: noop, noStroke: noop, stroke: noop, strokeWeight: noop,
    fill: noop, rect: noop, ellipse: noop, text: noop, textFont: noop, textAlign: noop,
    textSize: noop, image: noop, imageMode: noop, tint: noop, rectMode: noop, line: noop,
    drawSprites: noop, createSprite: makeSprite, Group: function () { return makeGroup(); },
    CENTER: "c", RIGHT: "r", TOP: "t", LEFT: "l", BOTTOM: "b", CORNER: "corner", CLOSE: "close",
    width: 600, height: 200, windowWidth: 1200, windowHeight: 400,
    createGraphics: (w, h) => ({ width: w, height: h, pixels: [60, 60, 60, 255], clear: noop, image: noop, loadPixels: noop, updatePixels: noop, noStroke: noop, fill: noop, ellipse: noop, triangle: noop, beginShape: noop, vertex: noop, endShape: noop, stroke: noop, strokeWeight: noop, line: noop, get: () => fakeImage("white", w, h) }),
  };
  sandbox.__canvasRect = { left: 0, top: 0, width: 600, height: 200 };
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
  sandbox.ghostRunFrames = [fakeImage("r0"), fakeImage("r1")];
  sandbox.ghostCollidedImage = fakeImage("gc");
  sandbox.setup();
  sandbox.trex.addAnimation("running", fakeImage("trex", 89, 94));
  sandbox.trex.scale = 0.5;
  sandbox.input = input;
  sandbox.canvasListeners = canvasListeners;
  return sandbox;
}

// Puts the sketch on a given screen, the way fillScreen() would, and updates
// the canvas rect the input is positioned against.
function useDevice(s, device) {
  s.windowWidth = device.w;
  s.windowHeight = device.h;
  s.fillScreen();
  const scale = Math.min(device.w / s.width, device.h / s.height);
  s.__canvasRect = {
    left: (device.w - s.width * scale) / 2,
    top: (device.h - s.height * scale) / 2,
    width: s.width * scale,
    height: s.height * scale,
  };
}

const px = (v) => parseFloat(String(v).replace("px", ""));

let failures = 0;
function check(label, ok, extra) {
  if (!ok) failures++;
  console.log(label.padEnd(56), ok ? "PASS" : "FAIL " + (extra === undefined ? "" : extra));
}

// -- The field must be legible, and never small enough to trigger the zoom.
{
  console.log("");
  let tooSmall = [];
  let clipped = [];
  let offCanvas = [];
  for (const device of DEVICES) {
    const s = load();
    useDevice(s, device);
    s.showRoomCodeInput();
    const style = s.input.style;
    const font = px(style.fontSize);
    const boxH = px(style.height);
    const boxW = px(style.width);
    const left = px(style.left);
    const top = px(style.top);

    if (font < 16) tooSmall.push(device.name + " " + font + "px");
    if (boxH < font) clipped.push(device.name);
    // Four characters plus their spacing have to fit inside the box.
    if (boxW < font * 4) clipped.push(device.name + " width");
    // And the whole field has to sit on screen.
    if (left < 0 || top < 0 || left + boxW > device.w || top + boxH > device.h) {
      offCanvas.push(device.name + " at " + Math.round(left) + "," + Math.round(top));
    }
    console.log("  " + device.name.padEnd(22), font + "px in " + Math.round(boxW) + "x" + Math.round(boxH));
  }
  console.log("");
  check("never small enough for iOS to zoom the page", tooSmall.length === 0, tooSmall.join("; "));
  check("the code always fits in its box", clipped.length === 0, clipped.join("; "));
  check("the field is always fully on screen", offCanvas.length === 0, offCanvas.join("; "));
}

// -- Centred on the same point the join screen draws around, allowing for the
//    trailing gap letter-spacing leaves after the last character.
{
  const s = load();
  useDevice(s, { name: "phone", w: 390, h: 844 });
  s.showRoomCodeInput();
  const style = s.input.style;
  const centre = px(style.left) + px(style.width) / 2;
  const scale = s.__canvasRect.width / s.width;
  const expected = s.__canvasRect.left + 300 * scale;
  check("the field is centred horizontally", Math.abs(centre - expected) < 1, centre + " vs " + expected);
  check("letter spacing is compensated for", px(style.textIndent) > 0, style.textIndent);
  check("spacing scales with the text", px(style.letterSpacing) >= 5, style.letterSpacing);
}

// -- Tapping JOIN must focus the field inside that tap, not a frame later.
{
  const s = load();
  useDevice(s, { name: "phone", w: 390, h: 844 });
  s.gameState = s.MULTIPLAYER_MENU;

  const b = s.MULTIPLAYER_JOIN_BUTTON;
  const scale = s.__canvasRect.width / s.width;
  const tap = {
    clientX: s.__canvasRect.left + b.x * scale,
    clientY: s.__canvasRect.top + (b.y + s.viewOffsetY) * scale,
    pointerType: "touch",
  };
  check("the join button is wired to the canvas", typeof s.canvasListeners.pointerdown === "function");

  s.canvasListeners.pointerdown(tap);
  check("the tap asks to join", s.multiplayerJoinRequested === true);
  check("the keyboard is raised inside the tap", s.input.focusCount === 1, s.input.focusCount);
  check("the field is visible straight away", s.input.style.display === "block");

  // The deferred path then runs as before, and must not undo any of it.
  s.input.value = "AB12";
  clock += 16;
  s.draw();
  check("the join screen is reached", s.gameState === s.MULTIPLAYER_JOIN_ENTRY, s.gameState);
  check("typing is not wiped by the second show", s.input.value === "AB12", s.input.value);

  // Leaving and coming back does start empty.
  s.hideRoomCodeInput();
  s.showRoomCodeInput();
  check("a fresh visit starts empty", s.input.value === "");
}

// -- Rotating the phone while the field is open keeps it on the canvas.
{
  const s = load();
  useDevice(s, { name: "portrait", w: 390, h: 844 });
  s.gameState = s.MULTIPLAYER_JOIN_ENTRY;
  s.showRoomCodeInput();
  useDevice(s, { name: "landscape", w: 844, h: 390 });
  s.windowResized();

  const style = s.input.style;
  const left = px(style.left), top = px(style.top);
  const w = px(style.width), h = px(style.height);
  check("rotation keeps the field on screen",
    left >= 0 && top >= 0 && left + w <= 844 && top + h <= 390,
    [left, top, w, h].map(Math.round).join(","));
  check("rotation keeps the text big enough", px(style.fontSize) >= 16, style.fontSize);
}

console.log("");
console.log(failures === 0 ? "ALL PASS" : failures + " FAILED");
process.exit(failures === 0 ? 0 : 1);
