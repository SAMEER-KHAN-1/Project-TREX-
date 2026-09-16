const path = require("path");
const WebSocket = require(path.join(__dirname, "..", "server", "node_modules", "ws"));
//the runner starts a relay on this port; falls back to the default for a
//manual run against `npm start`
const PORT = process.env.TREX_TEST_PORT || "8080";
const URL = "ws://localhost:" + PORT;

let failures = 0;
function check(label, ok) { if (!ok) failures++; console.log(label.padEnd(50), ok ? "PASS" : "FAIL"); }

function open(name) {
  const ws = new WebSocket(URL);
  ws.seen = [];
  ws.on("message", (raw) => ws.seen.push(JSON.parse(raw)));
  //sending on a CONNECTING socket throws, and a fixed sleep is not a guarantee
  ws.ready = new Promise((resolve, reject) => {
    ws.on("open", resolve);
    ws.on("error", reject);
  });
  return ws;
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const sent = (ws, obj) => ws.send(JSON.stringify(obj));
const typesOf = (ws, t) => ws.seen.filter((m) => m.type === t);

(async () => {
  const a = open("host");
  const b = open("guest");
  await Promise.all([a.ready, b.ready]);

  sent(a, { type: "create" });
  await wait(200);
  const room = a.seen.find((m) => m.type === "created").room;
  sent(b, { type: "join", room });
  await wait(200);

  const firstSeed = a.seen.find((m) => m.type === "start").seed;
  check("match started", typeof firstSeed === "number");

  // One side asking is not enough to drag the other into a race.
  sent(a, { type: "rematch" });
  await wait(250);
  check("one rematch request does not start", typesOf(a, "start").length === 1);
  check("opponent is told of the offer", typesOf(b, "opponent_wants_rematch").length === 1);

  // Clicking again must not spam the opponent.
  sent(a, { type: "rematch" });
  await wait(250);
  check("repeat request is not re-notified", typesOf(b, "opponent_wants_rematch").length === 1);

  // Both agreeing starts a fresh match.
  sent(b, { type: "rematch" });
  await wait(250);
  check("both agreeing starts a rematch", typesOf(a, "start").length === 2 && typesOf(b, "start").length === 2);

  const secondSeed = typesOf(a, "start")[1].seed;
  check("rematch gets both players same seed", secondSeed === typesOf(b, "start")[1].seed);
  check("rematch is a new course, not a replay", secondSeed !== firstSeed);
  check("rematch sends a fresh countdown", typesOf(a, "start")[1].countdownMs === 3000);

  // Readiness must have been cleared, or a single click would start race 3.
  sent(a, { type: "rematch" });
  await wait(250);
  check("readiness resets between matches", typesOf(a, "start").length === 2);

  a.close(); b.close();
  await wait(200);
  console.log("");
  console.log(failures === 0 ? "ALL PASS" : failures + " FAILED");
  process.exit(failures === 0 ? 0 : 1);
})();
