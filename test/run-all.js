// Runs every test suite. The multiplayer ones need the relay running, so this
// starts a server on a spare port, waits for it, and shuts it down afterwards -
// otherwise they would either be skipped in practice or fail confusingly on a
// machine where nobody happened to have `npm start` going.
const { spawn, spawnSync } = require("child_process");
const net = require("net");
const path = require("path");

const ROOT = path.join(__dirname, "..");

//module scope, because runSuite() passes it to every child process
let integrationPort = null;

// Asks the OS for a free port rather than hardcoding one. A fixed port made
// the run flaky: a relay from a previous run that had not finished releasing
// its socket, or any unrelated process on that number, and the whole suite
// failed with an address-in-use trace that looked like a real test failure.
function reserveFreePort() {
  return new Promise(function (resolve, reject) {
    const probe = net.createServer();
    probe.unref();
    probe.on("error", reject);
    probe.listen(0, "127.0.0.1", function () {
      const port = probe.address().port;
      probe.close(function () { resolve(port); });
    });
  });
}

// Run under a stubbed p5 - no browser, no server needed.
const UNIT = [
  "determinism-test.js",
  "spacing-test.js",
  "playable-test.js",
  "duckjump-test.js",
  "varjump-test.js",
  "touchzone-test.js",
  "multitouch-test.js",
  "outline-test.js",
  "ghost-test.js",
  "sharelink-test.js",
  "bugfix-test.js",
  "forfeit-test.js",
  "disconnect-test.js",
  "ui-test.js",
  "resize-test.js",
  "clicktarget-test.js",
  "perf-test.js",
  "roominput-test.js",
  "statemachine-test.js",
  "highscore-test.js",
  "autopause-test.js",
  "level-test.js",
  "connect-test.js",
  "deploy-test.js",
  "monkey-test.js",
];

// Talk to a real relay over a real WebSocket.
const INTEGRATION = [
  "relay-test.js",
  "race-test.js",
  "rematch-test.js",
  "server-hardening-test.js",
  "static-test.js",
];

function waitForPort(port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  return new Promise(function (resolve, reject) {
    (function attempt() {
      const socket = net.connect(port, "127.0.0.1");
      socket.on("connect", function () { socket.end(); resolve(); });
      socket.on("error", function () {
        socket.destroy();
        if (Date.now() > deadline) {
          reject(new Error("server did not come up on port " + port));
          return;
        }
        setTimeout(attempt, 100);
      });
    })();
  });
}

function runSuite(file) {
  const started = Date.now();
  const result = spawnSync(process.execPath, [path.join(__dirname, file)], {
    encoding: "utf8",
    env: Object.assign({}, process.env, { TREX_TEST_PORT: String(integrationPort) }),
  });
  const ms = Date.now() - started;
  const passed = result.status === 0;
  const counts = (result.stdout || "").match(/PASS/g);
  const label = passed
    ? "ok   " + String(counts ? counts.length : 0).padStart(3) + " checks"
    : "FAIL";
  console.log("  " + file.padEnd(27) + label.padEnd(16) + (ms + "ms").padStart(7));
  if (!passed) {
    console.log("");
    console.log((result.stdout || "").trimEnd());
    console.log((result.stderr || "").trimEnd());
    console.log("");
  }
  return passed;
}

(async function main() {
  let failed = 0;
  integrationPort = await reserveFreePort();

  console.log("");
  console.log("unit suites");
  for (const file of UNIT) {
    if (!runSuite(file)) failed++;
  }

  console.log("");
  console.log("integration suites (against a real relay on port " + integrationPort + ")");
  const server = spawn(process.execPath, [path.join(ROOT, "server", "server.js")], {
    env: Object.assign({}, process.env, { PORT: String(integrationPort) }),
    stdio: "ignore",
  });
  //surfaced rather than swallowed, so a relay that dies on startup says so
  server.on("error", function (e) { console.log("  relay failed to spawn: " + e.message); });

  try {
    await waitForPort(integrationPort, 8000);
    for (const file of INTEGRATION) {
      if (!runSuite(file)) failed++;
    }
  } catch (e) {
    console.log("  could not start the relay: " + e.message);
    failed++;
  } finally {
    server.kill();
  }

  console.log("");
  console.log(failed === 0
    ? "all " + (UNIT.length + INTEGRATION.length) + " suites passed"
    : failed + " suite(s) failed");
  process.exit(failed === 0 ? 0 : 1);
})();
