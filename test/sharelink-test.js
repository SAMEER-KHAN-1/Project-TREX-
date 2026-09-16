// Exercises the real roomShareUrl() / readRoomFromUrl() against a range of
// page addresses, including the LAN-over-http case the feature exists for.
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const SRC = fs.readFileSync(path.join(__dirname, "..", "sketch.js"), "utf8");

const noop = () => {};
let failures = 0;
function check(label, ok) { if (!ok) failures++; console.log(label.padEnd(52), ok ? "PASS" : "FAIL"); }

function load(location) {
  const sandbox = {
    window: { location, isSecureContext: false },
    navigator: {},
    Math, JSON, Number, String, Array, Object, Infinity, console, RegExp,
    document: { addEventListener: noop, querySelector: () => null, createElement: () => ({ style: {}, addEventListener: noop, select: noop }), body: { appendChild: noop, removeChild: noop } },
    p5: { prototype: { _updateTouchCoords: noop }, instance: {} },
    millis: () => 0, random: () => 0.5, constrain: (v, lo, hi) => Math.min(hi, Math.max(lo, v)),
    createGraphics: () => ({ clear: noop, noStroke: noop, fill: noop, ellipse: noop, triangle: noop, beginShape: noop, vertex: noop, endShape: noop, stroke: noop, strokeWeight: noop, line: noop, get: () => ({ width: 46, height: 30 }) }),
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(SRC, sandbox);
  return sandbox;
}

const lan = load({ protocol: "http:", host: "192.168.29.1:8080", origin: "http://192.168.29.1:8080", pathname: "/", search: "" });
check("LAN http page yields a shareable url",
  lan.roomShareUrl("WXYZ") === "http://192.168.29.1:8080/?room=WXYZ");

const deployed = load({ protocol: "https:", host: "trex.onrender.com", origin: "https://trex.onrender.com", pathname: "/", search: "" });
check("deployed https page yields https link",
  deployed.roomShareUrl("AB12") === "https://trex.onrender.com/?room=AB12");

const disk = load({ protocol: "file:", host: "", origin: "null", pathname: "/C:/game/index.html", search: "" });
check("file:// page offers no link to share", disk.roomShareUrl("WXYZ") === null);

// Reading a code back out of the address.
const cases = [
  ["?room=ABCD", "ABCD", "plain room param"],
  ["?room=abcd", "ABCD", "lowercase is normalised"],
  ["?server=ws://x:8080&room=QR34", "QR34", "room after another param"],
  ["?room=QR34&server=ws://x:8080", "QR34", "room before another param"],
  ["", null, "no query string"],
  ["?room=ABC", null, "too-short code rejected"],
  ["?room=ABCDE", null, "too-long code rejected"],
  ["?roomy=ABCD", null, "similarly-named param ignored"],
];
for (const [search, expected, label] of cases) {
  const s = load({ protocol: "http:", host: "h:8080", origin: "http://h:8080", pathname: "/", search });
  check(label, s.readRoomFromUrl() === expected);
}

// A generated link must be readable back as the same code - the round trip is
// the whole point.
const made = lan.roomShareUrl("K7NP");
const back = load({ protocol: "http:", host: "192.168.29.1:8080", origin: "http://192.168.29.1:8080", pathname: "/", search: made.slice(made.indexOf("?")) });
check("generated link round-trips to its code", back.readRoomFromUrl() === "K7NP");

// The insecure-context fallback must actually be taken, not skipped.
{
  const s = load({ protocol: "http:", host: "192.168.29.1:8080", origin: "http://192.168.29.1:8080", pathname: "/", search: "" });
  let execCalled = false;
  s.document.execCommand = () => { execCalled = true; return true; };
  s.copyRoomLink("http://192.168.29.1:8080/?room=WXYZ");
  check("plain-http copy uses execCommand fallback", execCalled);
}

console.log("");
console.log(failures === 0 ? "ALL PASS" : failures + " FAILED");
process.exit(failures === 0 ? 0 : 1);
