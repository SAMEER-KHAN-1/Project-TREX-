const path = require("path");
const WebSocket = require(path.join(__dirname, "..", "server", "node_modules", "ws"));
//the runner starts a relay on this port; falls back to the default for a
//manual run against `npm start`
const PORT = process.env.TREX_TEST_PORT || "8080";
const URL = "ws://localhost:" + PORT;

const host = new WebSocket(URL);
let roomCode = null;

host.on("message", (raw) => {
  const msg = JSON.parse(raw);
  console.log("HOST  <-", JSON.stringify(msg));
  if (msg.type === "created") {
    roomCode = msg.room;
    const guest = new WebSocket(URL);
    guest.on("open", () => guest.send(JSON.stringify({ type: "join", room: roomCode })));
    guest.on("message", (r2) => {
      const m2 = JSON.parse(r2);
      console.log("GUEST <-", JSON.stringify(m2));
      if (m2.type === "start") {
        guest.send(JSON.stringify({ type: "state", y: 123, crouching: false, dead: false, score: 42 }));
        setTimeout(() => { guest.close(); }, 300);
      }
    });
  }
  if (msg.type === "opponent_state") {
    console.log("RELAY OK: host received guest state");
  }
  if (msg.type === "opponent_left") {
    console.log("DISCONNECT OK");
    host.close();
    process.exit(0);
  }
});

host.on("open", () => host.send(JSON.stringify({ type: "create" })));
setTimeout(() => { console.log("TIMEOUT"); process.exit(1); }, 6000);
