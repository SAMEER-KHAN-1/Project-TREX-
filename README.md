# Project-TREX-

A T-Rex runner in the spirit of Chrome's offline dino, built with p5.js and
p5.play — with a two-player head-to-head race mode over the network.

Two people on separate devices join a room, get the **same randomly generated
obstacle course**, and run it at the same time. You see your opponent as a
translucent blue ghost overlaid on your own track, so you can tell at a glance
whether they cleared the cactus you're about to hit. Highest score wins.

---

## Playing

| Action | Keyboard | Touch |
| --- | --- | --- |
| Jump — **hold longer to jump higher** | `Space` / `↑` / `W` | tap the top half |
| Duck (and fast-fall in mid-air) | `↓` / `S` | hold the bottom half |
| Pause | `P` | pause button, top left |
| Mute | `M` | speaker button, top left |
| Fullscreen | `F` | — |
| Restart after a crash | `Space` / `↑` / `W` / `Enter` | tap anywhere |
| Rematch (after a race) | `R` | REMATCH button |
| Back to the menu | `Esc` | MENU button |

A quick tap gives a short hop that lands sooner and still clears the tallest
cactus; holding gets you roughly twice the height and the airtime to deal with
whatever is behind it.

Things that show up as you survive longer: crows you have to **duck** rather
than jump, low crow pairs that force a duck straight into a jump, boulders, and
a day/night cycle that flips every 700 points. Dark sprites get a white outline
at night so they stay readable against the dark sky and sand.

The speaker and pause buttons sit in the top-left corner of the playfield and
are the only way to reach either without a keyboard. A tap on one of them is
just that — it does not also jump, or retry a finished run.

Pausing is disabled during a race — your opponent's run carries on regardless,
so it would just be free thinking time.

## Racing someone

One player picks **MULTIPLAYER → CREATE ROOM** and gets a 4-character code plus
a **COPY LINK** button. The other player either types the code under **JOIN
ROOM**, or just opens the link — which drops them straight into the room. Both
players then count down together and start at the same moment.

If your opponent crashes first you're told their final score, so you know
exactly what to beat. If they quit mid-run they leave the track and it's a
forfeit. If the connection dies mid-race it's declared unscored, rather than
left running against a ghost that has silently stopped moving — but a race
that was already decided keeps its result, since the socket is only needed for
a rematch by then.

An invite link is single use: the room is dropped as soon as either player
leaves, so the code is taken back out of the address bar once it has been
used.

## Running it locally

```bash
cd server
npm install
npm start
```

Then open <http://localhost:8080>.

The server prints the addresses other devices can reach it on. To race against
a phone on the same wifi, open the printed `http://<lan-ip>:8080` address there.
On Windows you may need to allow Node through the firewall on **private
networks** the first time, or the phone will silently fail to connect.

Opening `index.html` directly from disk works for single player, but
multiplayer needs the server, since that is what hands out rooms.

## Deploying

`render.yaml` configures a single free Render web service. Point Render at the
repo as a Blueprint and it will serve the game and run the relay together, so
there is nothing to configure afterwards — the client works out its own
WebSocket address from whatever URL the page was loaded from.

The service deliberately has no `rootDir`. Render leaves everything outside a
service's root directory out of the deploy, and the server hosts the game's
files from the repo root, so pointing it at `server/` would ship a relay with no
game to serve. The build installs the relay's one dependency into `server/`
instead.

Free instances sleep when idle, so the first load after a quiet spell takes
30–60 seconds, and an idle socket may be dropped mid-race.

## Tests

```bash
npm test
```

Runs from the repo root, needs no browser, and takes about forty seconds. The
runner starts its own relay on a spare port for the four suites that speak
real WebSockets, then shuts it down.

The game is one big p5 sketch, so the suites load `sketch.js` into a stubbed p5
and drive the real `draw()` loop rather than testing copies of the logic. What
they cover, and why each exists:

| Suite | Guards |
| --- | --- |
| `determinism-test` | Both racers generate the identical course at 60, 144 and 240Hz |
| `spacing-test` | No two obstacles ever arrive closer than 1.35 jump lengths |
| `playable-test` | Every obstacle is clearable at every speed, and by how wide a margin |
| `duckjump-test` | Jumping out of a duck works — the crow pair depends on it |
| `varjump-test` | Hold time controls jump height, identically on any refresh rate |
| `touchzone-test` | Jump/duck zones land on the playfield across five device shapes |
| `multitouch-test` | Two fingers duck and jump independently |
| `outline-test` | Dark sprites get a night outline; bright ones are left alone |
| `ghost-test` | The opponent ghost interpolates and crouches correctly |
| `sharelink-test` | Room links round-trip, including over plain http on a LAN |
| `bugfix-test` | Regressions for four fixed multiplayer bugs |
| `forfeit-test` | An opponent who quits leaves the track, the HUD and the banner |
| `disconnect-test` | A decided result survives a dropped socket; no rematch into an empty room |
| `ui-test` | Button hover/press, and every overlay screen renders |
| `resize-test` | Buttons and touch zones survive rotation and resizing |
| `roominput-test` | The room code field is typable on seven device shapes |
| `statemachine-test` | Every screen transition, plus forfeits and dropped sockets |
| `highscore-test` | A new best survives closing the tab, without writing every frame |
| `connect-test` | A sleeping server explains itself, then gives up rather than hanging |
| `deploy-test` | `render.yaml` ships every file the page loads, and the start command serves them |
| `monkey-test` | 100,000 frames of random input — no crash, wedge, NaN or leak |
| `relay/race/rematch-test` | The wire protocol, against a real server |
| `server-hardening-test` | Junk frames, oversized frames and room hoarding |

`test/tools/measure-art.js` prints the luminance of every sprite against the
night palette. It is not a test — it is where the outline threshold's value
came from, kept so the number can be re-derived rather than guessed at. It
shares its PNG decoder with `playable-test`, which needs the real silhouettes
because collisions follow the artwork's shape, not its bounding box.

`playable-test` is the one that answers whether the game is any good to play.
It brute-forces every input timing against every obstacle at every speed and
reports how many frames of leeway each one leaves:

```
  obstacle                           start        fast         max
  ----------------------------------------------------------------
  cactus 1 (real art)                  50f         50f         36f
  cactus 6 (real art)                  30f         38f         30f
  boulder (box)                        46f         49f         37f
  crow (box)                           42f         47f         34f
  crow pair (box)                      16f         30f         34f
```

The crow pair is the tightest thing in the game at 16 frames — about a quarter
of a second — and that is a lower bound, since the procedurally drawn crow
stands in as a full rectangle, which is larger than the bird inside it.

## How the multiplayer works

The server is a **relay, not an authority**. It hands out room codes, issues one
shared seed per match, and forwards each player's position to their opponent.
That is all. Both clients run the whole game themselves.

Because they share a seed, neither client ever has to be told what the course
is — they each generate an identical one. Keeping that true is the delicate
part, and two rules in `sketch.js` protect it:

1. **Obstacles draw from their own random stream.** p5's global `random()` is
   shared with the clouds and the death-shake, and the shake is rolled once per
   *frame* — so a 60Hz and a 144Hz machine would consume different amounts and
   drift apart within seconds.
2. **Every spawn draws a fixed number of values, and unlock gates key off the
   obstacle count rather than the score.** A score threshold is crossed at
   fractionally different moments on each machine, and one client taking a
   branch the other didn't would desync the course permanently.

Positions sync 20 times a second and are interpolated between updates, rather
than being sent every frame — at 240Hz that would be 240 messages a second at a
free-tier relay for no visible gain.

Since the server trusts whatever a client reports, this is fine for a casual
race with someone you know and not for anything competitive.

## Layout

```
index.html        page shell
sketch.js         the whole game: rendering, physics, netcode, UI
style.css
p5.js p5.play.js  vendored libraries
*.png             sprites (crows and boulders are drawn in code)
server/server.js  static file hosting + the WebSocket room relay
render.yaml       Render deployment config
```
