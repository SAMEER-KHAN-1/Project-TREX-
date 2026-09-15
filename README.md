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
| Pause | `P` | — |
| Mute | `M` | — |
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

Pausing is disabled during a race — your opponent's run carries on regardless,
so it would just be free thinking time.

## Racing someone

One player picks **MULTIPLAYER → CREATE ROOM** and gets a 4-character code plus
a **COPY LINK** button. The other player either types the code under **JOIN
ROOM**, or just opens the link — which drops them straight into the room. Both
players then count down together and start at the same moment.

If your opponent crashes first you're told their final score, so you know
exactly what to beat. If they quit mid-run it's a forfeit. If the connection
dies the race is declared unscored rather than left running against a ghost
that has silently stopped moving.

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

Free instances sleep when idle, so the first load after a quiet spell takes
30–60 seconds, and an idle socket may be dropped mid-race.

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
