// Drives two clients through the full race protocol against the real server.
const path = require("path");
const WebSocket = require(path.join(__dirname, "..", "server", "node_modules", "ws"));

//the runner starts a relay on this port; falls back to the default for a
//manual run against `npm start`
const PORT = process.env.TREX_TEST_PORT || "8080";
const URL = "ws://localhost:" + PORT;

let failures = 0;
function check(label, ok) { if (!ok) failures++; console.log(label.padEnd(28), ok ? "PASS" : "FAIL"); }

// Waits for the socket to actually be open. Sending on a CONNECTING socket
// throws, and doing it on a timer instead made this suite fail roughly one run
// in four - the kind of intermittent red that teaches people to ignore tests.
function open(name) {
  const ws = new WebSocket(URL);
  ws.seen = [];
  ws.on("message", (raw) => {
    const msg = JSON.parse(raw);
    ws.seen.push(msg);
    console.log(name.padEnd(5), "<-", JSON.stringify(msg));
  });
  ws.ready = new Promise((resolve, reject) => {
    ws.on("open", resolve);
    ws.on("error", reject);
  });
  return ws;
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const send = (ws, obj) => ws.send(JSON.stringify(obj));
const typesOf = (ws, t) => ws.seen.filter((m) => m.type === t);
const firstOf = (ws, t) => ws.seen.find((m) => m.type === t);

// Resolves as soon as the message arrives, rather than after a fixed sleep.
function awaitMessage(ws, type, timeoutMs) {
  const existing = firstOf(ws, type);
  if (existing) return Promise.resolve(existing);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timed out waiting for " + type)), timeoutMs || 3000);
    ws.on("message", function onMsg(raw) {
      const msg = JSON.parse(raw);
      if (msg.type === type) {
        clearTimeout(timer);
        ws.removeListener("message", onMsg);
        resolve(msg);
      }
    });
  });
}

(async () => {
  const host = open("HOST");
  const guest = open("GUEST");
  await Promise.all([host.ready, guest.ready]);

  send(host, { type: "create" });
  const created = await awaitMessage(host, "created");
  send(guest, { type: "join", room: created.room });

  const hostStart = await awaitMessage(host, "start");
  const guestStart = await awaitMessage(guest, "start");

  check("both got the same seed", hostStart.seed === guestStart.seed);
  check("both got countdownMs=3000", hostStart.countdownMs === 3000 && guestStart.countdownMs === 3000);

  // Host crashes first on a lower score; guest survives longer.
  send(host, { type: "finished", score: 840 });
  const guestSaw = await awaitMessage(guest, "opponent_finished");
  check("guest learned the host score", guestSaw.score === 840);

  send(guest, { type: "finished", score: 1290 });
  const hostSaw = await awaitMessage(host, "opponent_finished");
  check("host learned the guest score", hostSaw.score === 1290);

  // Forfeit path: the host drops, the guest must be told.
  host.close();
  await awaitMessage(guest, "opponent_left");
  check("guest saw the host leave", typesOf(guest, "opponent_left").length === 1);

  guest.close();
  await wait(100);
  console.log("");
  console.log(failures === 0 ? "ALL PASS" : failures + " FAILED");
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => {
  console.log("ERROR: " + e.message);
  process.exit(1);
});
