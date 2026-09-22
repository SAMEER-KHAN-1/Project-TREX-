// What the drawing loop is allowed to do per frame.
//
// p5 0.8.0's tint() is not a canvas state flag - it is an uncached pixel
// filter. Every image() drawn while a tint is set builds a fresh <canvas>,
// reads the whole source with getImageData, allocates a new ImageData, and
// loops every pixel. The night outline stamps eight images per outlined
// sprite per frame, and this game runs draw() as fast as the display allows,
// so leaving a tint set around that loop cost thousands of full-image pixel
// passes a second for an effect that is one flat colour.
//
// These checks are about allocation per frame, not about pixels on screen -
// outline-test.js owns what the outline looks like.
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const SRC = fs.readFileSync(path.join(__dirname, "..", "sketch.js"), "utf8");

const noop = () => {};
let failures = 0;
function check(label, ok, extra) { if (!ok) failures++; console.log("  " + label.padEnd(50), ok ? "PASS" : "FAIL " + (extra || "")); }

let clock = 0;
let tintCalls = 0;
let graphicsBuilt = 0;
let imageDraws = 0;
const builtSizes = [];
const alphaSeen = [];
const canvasStyle = {};

// A stand-in for the real 2D context. globalAlpha is the whole point: it is
// free, and it composites at draw time instead of rewriting the image.
const drawingContext = { globalAlpha: 1 };

function fakeImage(name, w, h) {
  const width = w || 40, height = h || 40;
  return { __name: name, width, height, pixels: new Array(width * height * 4).fill(60), loadPixels: noop };
}
function makeSprite(x, y, w, h) {
  return {
    x, y, width: w, height: h, scale: 0.5, depth: 0, visible: true,
    velocityX: 0, velocityY: 0, lifetime: 0, animation: null, baseVelocityX: 0,
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
  window: { location: { search: "", protocol: "http:", host: "h:8080", origin: "http://h:8080", pathname: "/" }, addEventListener: noop, isSecureContext: false, innerWidth: 1200, innerHeight: 400 },
  navigator: {},
  Math, JSON, Number, String, Array, Object, Infinity, console, RegExp, Set,
  document: {
    addEventListener: noop,
    documentElement: { clientWidth: 1200, clientHeight: 400 },
    querySelector: () => ({ style: canvasStyle, addEventListener: noop, getBoundingClientRect: () => ({ left: 0, top: 0, width: 1200, height: 400 }) }),
    createElement: () => ({ style: {}, addEventListener: noop, select: noop, focus: noop, blur: noop, value: "" }),
    body: { appendChild: noop, removeChild: noop },
  },
  p5: { prototype: { _updateTouchCoords: noop }, instance: {} },
  localStorage: {}, millis: () => clock,
  drawingContext,
  random: (a, b) => (a === undefined ? 0.5 : b === undefined ? 0.5 * a : a + 0.5 * (b - a)),
  constrain: (v, lo, hi) => Math.min(hi, Math.max(lo, v)),
  keyDown: () => false, keyWentDown: () => false,
  createCanvas: (w, h) => { sandbox.width = w; sandbox.height = h; },
  resizeCanvas: (w, h) => { sandbox.width = w; sandbox.height = h; },
  frameRate: noop, background: noop,
  push: noop, pop: noop, translate: noop, noStroke: noop, stroke: noop, strokeWeight: noop,
  fill: noop, rect: noop, ellipse: noop, text: noop, textFont: noop, textAlign: noop,
  textSize: noop, imageMode: noop, rectMode: noop, line: noop,
  image: () => { imageDraws++; alphaSeen.push(drawingContext.globalAlpha); },
  tint: () => { tintCalls++; },
  drawSprites: noop, createSprite: makeSprite, Group: function () { return makeGroup(); },
  CENTER: "c", RIGHT: "r", TOP: "t", LEFT: "l", BOTTOM: "b", CORNER: "corner", CLOSE: "close",
  width: 600, height: 200, windowWidth: 1200, windowHeight: 400,
  createGraphics: (w, h) => {
    graphicsBuilt++;
    builtSizes.push(w + "x" + h);
    let source = null;
    return {
      width: w, height: h, pixels: [60, 60, 60, 255], clear: noop,
      image: (img) => { source = img; }, loadPixels: noop, updatePixels: noop,
      noStroke: noop, fill: noop, ellipse: noop, triangle: noop, beginShape: noop,
      vertex: noop, endShape: noop, stroke: noop, strokeWeight: noop, line: noop,
      get: () => fakeImage(source && source.__name ? source.__name : "derived", w, h),
    };
  },
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(SRC, sandbox);
sandbox.trex_running = fakeImage("trex", 89, 94); sandbox.trex_collided = fakeImage("trexdead", 89, 94);
sandbox.groundImage = fakeImage("ground", 2377, 12); sandbox.cloudImage = fakeImage("cloud", 92, 27);
for (let i = 1; i <= 6; i++) sandbox["obstacle" + i] = fakeImage("cactus" + i, 50, 100);
sandbox.gameOverImg = fakeImage("go", 381, 21); sandbox.restartImg = fakeImage("re", 75, 64);
sandbox.ghostRunFrames = [fakeImage("r0"), fakeImage("r1")]; sandbox.ghostCollidedImage = fakeImage("gc");
sandbox.setup();
sandbox.trex.addAnimation("running", fakeImage("trex", 89, 94));

// A night race with a crowded screen: the worst case the outline ever faces.
function setUpNightRace() {
  sandbox.gameState = sandbox.PLAY;
  sandbox.nightAmount = 1;
  sandbox.mpIsRacing = true;
  sandbox.mpOpponentY = 160;
  sandbox.mpOpponentAlive = true;
  sandbox.mpOpponentLeft = false;
  sandbox.obstaclesGroup.removeSprites();
  for (let i = 0; i < 4; i++) {
    const o = makeSprite(200 + i * 90, 150, 46, 30);
    o.addImage(fakeImage("crow" + i, 46, 30));
    sandbox.obstaclesGroup.add(o);
  }
}

// Caches are built lazily, the first time each asset is drawn. Warming them
// by playing frames would make these counts depend on which cactus the
// obstacle stream happened to deal out, so every image the game can reach is
// warmed directly instead.
function warmEveryCache() {
  const images = [
    sandbox.trex_running, sandbox.trex_collided, sandbox.groundImage, sandbox.cloudImage,
    sandbox.gameOverImg, sandbox.restartImg, sandbox.crowFrame1, sandbox.crowFrame2,
    sandbox.boulderImage, sandbox.ghostCollidedImage,
  ];
  for (let i = 1; i <= 6; i++) images.push(sandbox["obstacle" + i]);
  for (const f of sandbox.ghostRunFrames) images.push(f);
  for (const o of sandbox.obstaclesGroup) images.push(o.animation.getFrameImage());
  //the art the sprites are actually wearing, which is not always the same
  //object as the module-level image it was loaded from
  images.push(sandbox.trex.animation.getFrameImage());
  for (const img of images) {
    if (!img || !img.width) continue;
    sandbox.nightOutlineInfo(img);
    sandbox.tintedImage(img, sandbox.GHOST_TINT);
    //the collision silhouette is built from an offscreen buffer too, the
    //first time a given piece of art is tested against
    sandbox.imageProfile(img);
  }
}

setUpNightRace();
warmEveryCache();
const warmUpGraphics = graphicsBuilt;

tintCalls = 0; graphicsBuilt = 0; imageDraws = 0; alphaSeen.length = 0; builtSizes.length = 0;
const FRAMES = 60;
for (let i = 0; i < FRAMES; i++) { clock += 16; sandbox.draw(); }

console.log("a night race, " + FRAMES + " frames, " + imageDraws + " images drawn");
check("no per-frame tint() at all", tintCalls === 0, tintCalls + " calls");
check("no per-frame offscreen buffers", graphicsBuilt === 0, graphicsBuilt + " built: " + builtSizes.join(","));
check("the frame really did draw images", imageDraws > FRAMES, String(imageDraws));
check("caches were warmed once, up front", warmUpGraphics > 0, String(warmUpGraphics));

// Transparency is carried by globalAlpha, and it has to be put back: leaving
// it set would quietly fade everything drawn after the ghost.
check("images are drawn at a reduced alpha",
  alphaSeen.some((a) => a > 0 && a < 1), [...new Set(alphaSeen)].join(","));
check("globalAlpha is restored afterwards", drawingContext.globalAlpha === 1,
  String(drawingContext.globalAlpha));

//fading in and out of night must not rebuild anything either
graphicsBuilt = 0;
for (let i = 0; i < 30; i++) {
  sandbox.nightAmount = i / 29;
  clock += 16;
  sandbox.draw();
}
check("fading into night rebuilds nothing", graphicsBuilt === 0, String(graphicsBuilt));

// Every ghost frame is recoloured once, on the frame it is first shown, and
// never again - including after cycling back around to it.
sandbox.nightAmount = 0;
graphicsBuilt = 0;
for (let i = 0; i < 40; i++) { clock += sandbox.GHOST_FRAME_MS; sandbox.draw(); }
check("ghost frames are recoloured once each", graphicsBuilt === 0, String(graphicsBuilt));

// Without a drawingContext - an older browser, or a harness - the fallback
// still has to produce the same transparency.
sandbox.drawingContext = undefined;
tintCalls = 0;
clock += 16; sandbox.nightAmount = 1; sandbox.draw();
check("falls back to tint() with no drawingContext", tintCalls > 0, String(tintCalls));

console.log("");
console.log(failures === 0 ? "ALL PASS" : failures + " FAILED");
process.exit(failures === 0 ? 0 : 1);
