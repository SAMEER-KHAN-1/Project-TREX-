// Prints the average luminance of every sprite against the night palette.
//
// Not a test - this is where NIGHT_OUTLINE_LUMINANCE_MAX's value came from,
// kept so the threshold can be re-derived from the art rather than guessed at
// if the assets ever change. The PNG decoding lives in png.js, which
// playable-test.js also uses to get the real silhouettes.
const fs = require("fs");
const path = require("path");
const png = require("./png");
const DIR = path.join(__dirname, "..", "..");

function decode(file) {
  const image = png.decode(file);
  return image ? png.averageLuminance(image) : null;
}

const NIGHT_SKY = 0.2126 * 20 + 0.7152 * 24 + 0.0722 * 46;
const NIGHT_SAND = 0.2126 * 60 + 0.7152 * 56 + 0.0722 * 48;
console.log("night sky luminance :", NIGHT_SKY.toFixed(1));
console.log("night sand luminance:", NIGHT_SAND.toFixed(1));
console.log("");
console.log("asset".padEnd(22), "luminance", " vs sand", " vs sky");
for (const f of fs.readdirSync(DIR).filter((f) => f.endsWith(".png")).sort()) {
  const l = decode(path.join(DIR, f));
  if (l === null) { console.log(f.padEnd(22), "(unsupported)"); continue; }
  console.log(f.padEnd(22), l.toFixed(1).padStart(9), (l - NIGHT_SAND).toFixed(1).padStart(8), (l - NIGHT_SKY).toFixed(1).padStart(8));
}
// The two procedurally drawn obstacles, from their fill() calls in sketch.js
console.log("");
console.log("crow   (40,40,40)    ", (0.2126 * 40 + 0.7152 * 40 + 0.0722 * 40).toFixed(1));
console.log("boulder(95,90,85)    ", (0.2126 * 95 + 0.7152 * 90 + 0.0722 * 85).toFixed(1));
