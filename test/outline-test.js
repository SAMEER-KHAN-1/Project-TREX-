// Drives the real night-outline code and records what it stamps.
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const SRC = fs.readFileSync(path.join(__dirname, "..", "sketch.js"), "utf8");

const noop = () => {};
let failures = 0;
function check(label, ok) { if (!ok) failures++; console.log(label.padEnd(54), ok ? "PASS" : "FAIL"); }

const drawn = [];
const tints = [];
let graphicsBuilt = 0;
// Dark by default (the trex's real colour, luminance 83.9).
let nextGraphicsColor = [84, 84, 84];

// A fake 4x2 image: left half opaque dark grey, right half fully transparent.
function fakeImage(name) {
  return { __name: name, width: 4, height: 2 };
}

const sandbox = {
  window: { location: { search: "", protocol: "http:", host: "h" } }, navigator: {},
  Math, JSON, Number, String, Array, Object, Infinity, console, RegExp,
  document: { addEventListener: noop, querySelector: () => null, createElement: () => ({ style: {}, addEventListener: noop, select: noop }), body: { appendChild: noop, removeChild: noop } },
  p5: { prototype: { _updateTouchCoords: noop }, instance: {} },
  millis: () => 0, random: () => 0.5, constrain: (v, lo, hi) => Math.min(hi, Math.max(lo, v)),
  push: noop, pop: noop, imageMode: noop, CENTER: "c",
  tint: (...a) => tints.push(a),
  image: (img, x, y, w, h) => drawn.push({ img: img.__name, x, y, w, h }),
  createGraphics: (w, h) => {
    graphicsBuilt++;
    // Half the pixels opaque, half transparent - so we can assert the opaque
    // ones came out white and the transparent ones were left alone. The
    // colour comes from nextGraphicsColor so a test can make the art bright
    // or dark and check the luminance gate.
    const c = nextGraphicsColor;
    const px = [ c[0],c[1],c[2],255,  c[0],c[1],c[2],255,  0,0,0,0,  0,0,0,0,
                 c[0],c[1],c[2],255,  c[0],c[1],c[2],255,  0,0,0,0,  0,0,0,0 ];
    return {
      width: w, height: h, pixels: px,
      clear: noop, image: noop, loadPixels: noop, updatePixels: noop,
      noStroke: noop, fill: noop, ellipse: noop, triangle: noop, beginShape: noop,
      vertex: noop, endShape: noop, stroke: noop, strokeWeight: noop, line: noop,
      get: () => ({ __name: "white:" + w + "x" + h, width: w, height: h, __px: px }),
    };
  },
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(SRC, sandbox);

// -- Daytime draws no outline at all.
drawn.length = 0;
sandbox.drawNightOutline(fakeImage("a"), 50, 100, 40, 40, 0);
check("no outline in daylight", drawn.length === 0);

// -- Night stamps the silhouette in all eight directions.
drawn.length = 0; tints.length = 0;
const img = fakeImage("b");
sandbox.drawNightOutline(img, 50, 100, 40, 40, 1);
check("stamps eight directions at night", drawn.length === 8);
check("all stamps use the white silhouette", drawn.every((d) => d.img.startsWith("white:")));
check("stamps surround the sprite centre",
  drawn.every((d) => Math.abs(d.x - 50) <= 2 && Math.abs(d.y - 100) <= 2) &&
  new Set(drawn.map((d) => d.x + "," + d.y)).size === 8);
check("no stamp sits on the centre itself", !drawn.some((d) => d.x === 50 && d.y === 100));

// -- Opaque pixels became white; transparent ones were left untouched.
const white = sandbox.nightOutlineInfo(img).silhouette;
check("opaque pixels forced to white", white.__px[0] === 255 && white.__px[1] === 255 && white.__px[2] === 255);
check("opaque pixels keep their alpha", white.__px[3] === 255);
check("transparent pixels stay transparent", white.__px[11] === 0 && white.__px[8] === 0);

// -- The luminance gate, checked against the project's REAL measured colours.
// Anything at or above the cacti must be left alone; anything at or below the
// boulder must be outlined.
function outlineCountFor(rgb, name) {
  nextGraphicsColor = rgb;
  drawn.length = 0;
  sandbox.drawNightOutline(fakeImage(name), 50, 100, 40, 40, 1);
  return drawn.length;
}
check("crow (lum 40) is outlined", outlineCountFor([40, 40, 40], "crow") === 8);
check("trex (lum 84) is outlined", outlineCountFor([84, 84, 84], "trexart") === 8);
check("boulder (lum 91) is outlined", outlineCountFor([95, 90, 85], "boulder") === 8);
check("cactus (lum 149) is left alone", outlineCountFor([46, 180, 74], "cactus") === 0);
check("cloud (lum 255) is left alone", outlineCountFor([255, 255, 255], "cloud") === 0);
nextGraphicsColor = [84, 84, 84];

// -- Built once per image, not once per frame.
graphicsBuilt = 0;
for (let i = 0; i < 50; i++) sandbox.drawNightOutline(img, 50, 100, 40, 40, 1);
check("silhouette is cached, not rebuilt", graphicsBuilt === 0);

// -- Strength drives the alpha, so it fades in with the night.
tints.length = 0;
sandbox.drawNightOutline(img, 50, 100, 40, 40, 0.5);
check("outline alpha follows night strength", tints[0][3] === 127.5);

// -- Crouching: the outline follows the sprite's stretched scale, not its
//    standing size, so a ducking trex is not outlined as if it were upright.
drawn.length = 0;
sandbox.nightAmount = 1;
sandbox.trex = {
  x: 50, y: 170,
  animation: { getFrameImage: () => fakeImage("trex") },
  _getScaleX: () => 0.5 * 1.35,
  _getScaleY: () => 0.5 * 0.55,
};
sandbox.drawSpriteNightOutline(sandbox.trex, sandbox.nightAmount);
check("crouched outline widens with the sprite", Math.abs(drawn[0].w - 4 * 0.5 * 1.35) < 0.001);
check("crouched outline shortens with the sprite", Math.abs(drawn[0].h - 2 * 0.5 * 0.55) < 0.001);

console.log("");
console.log(failures === 0 ? "ALL PASS" : failures + " FAILED");
process.exit(failures === 0 ? 0 : 1);
