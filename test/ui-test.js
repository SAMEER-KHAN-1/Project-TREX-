// Button hover / press / cursor behaviour, driven through the real draw loop.
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const SRC = fs.readFileSync(path.join(__dirname, "..", "sketch.js"), "utf8");

const noop = () => {};
let failures = 0;
function check(label, ok, extra) { if (!ok) failures++; console.log(label.padEnd(52), ok ? "PASS" : "FAIL " + (extra || "")); }

let clock = 0;
const rects = [];
const texts = [];
let currentTextSize = 12;
const canvasStyle = {};
const listeners = {};

function fakeImage(name, w, h) {
  const width = w || 88, height = h || 94;
  return { __name: name, width, height, pixels: new Array(width * height * 4).fill(255), loadPixels: noop };
}
function makeSprite(x, y, w, h) {
  return {
    x, y, width: w, height: h, scale: 1, depth: 0, visible: true,
    velocityX: 0, velocityY: 0, lifetime: 0, animation: null, baseVelocityX: 0,
    //p5.play's addImage takes either (image) or (label, image) - the ground
    //is added with a label, and reading the label as the image left the
    //sprite's width NaN, which no wrap-around can be measured against
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
  window: { location: { search: "", protocol: "http:", host: "h:8080", origin: "http://h:8080", pathname: "/" }, addEventListener: noop, isSecureContext: false },
  navigator: {},
  Math, JSON, Number, String, Array, Object, Infinity, console, RegExp, Set,
  document: {
    addEventListener: noop,
    querySelector: () => ({
      style: canvasStyle,
      addEventListener: (n, fn) => { listeners[n] = fn; },
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 600, height: 200 }),
    }),
    createElement: () => ({ style: {}, addEventListener: noop, select: noop, focus: noop, blur: noop }),
    body: { appendChild: noop, removeChild: noop },
  },
  p5: { prototype: { _updateTouchCoords: noop }, instance: {} },
  localStorage: {}, millis: () => clock,
  random: (a, b) => (a === undefined ? 0.5 : b === undefined ? 0.5 * a : a + 0.5 * (b - a)),
  constrain: (v, lo, hi) => Math.min(hi, Math.max(lo, v)),
  keyDown: () => false, keyWentDown: () => false,
  createCanvas: noop, resizeCanvas: noop, frameRate: noop, background: noop,
  push: noop, pop: noop, translate: noop, noStroke: noop, stroke: noop, strokeWeight: noop,
  fill: (...a) => rects.push({ kind: "fill", a }),
  rect: (x, y, w, h, r) => rects.push({ kind: "rect", x, y, w, h, r, fill: lastFill() }),
  ellipse: noop,
  text: (str, x, y) => texts.push({ str: String(str), x, y, size: currentTextSize, fill: lastFill() }),
  textFont: noop, textAlign: noop, textSize: (n) => { currentTextSize = n; },
  image: noop, imageMode: noop, tint: noop, rectMode: noop, line: noop,
  drawSprites: noop, createSprite: makeSprite, Group: function () { return makeGroup(); },
  CENTER: "c", RIGHT: "r", TOP: "t", LEFT: "l", BOTTOM: "b", CORNER: "corner", CLOSE: "close",
  width: 600, height: 200, windowWidth: 1200, windowHeight: 400,
  createGraphics: (w, h) => ({ width: w, height: h, pixels: [60, 60, 60, 255], clear: noop, image: noop, loadPixels: noop, updatePixels: noop, noStroke: noop, fill: noop, ellipse: noop, triangle: noop, beginShape: noop, vertex: noop, endShape: noop, stroke: noop, strokeWeight: noop, line: noop, get: () => fakeImage("white", w, h) }),
};
function lastFill() {
  for (let i = rects.length - 1; i >= 0; i--) if (rects[i].kind === "fill") return rects[i].a;
  return null;
}
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(SRC, sandbox);
sandbox.trex_running = { __name: "running" }; sandbox.trex_collided = { __name: "collided" };
sandbox.groundImage = fakeImage("ground", 2377, 12); sandbox.cloudImage = fakeImage("cloud", 92, 27);
for (let i = 1; i <= 6; i++) sandbox["obstacle" + i] = fakeImage("cactus" + i, 50, 100);
sandbox.gameOverImg = fakeImage("go", 381, 21); sandbox.restartImg = fakeImage("re", 75, 64);
sandbox.ghostRunFrames = [fakeImage("r0")]; sandbox.ghostCollidedImage = fakeImage("gc");
sandbox.setup();
sandbox.trex.addAnimation("running", fakeImage("trex", 89, 94));
sandbox.trex.scale = 0.5;

function frame() { clock += 16; rects.length = 0; texts.length = 0; sandbox.draw(); }
const drewText = (needle) => texts.some((t) => t.str.indexOf(needle) !== -1);
// The canvas is 600x200 here, so strip coords and client coords line up.
const at = (b) => ({ clientX: b.x, clientY: b.y, pointerType: "mouse" });

const BTN = sandbox.MENU_SINGLE_PLAYER_BUTTON;
const OTHER = sandbox.MENU_MULTIPLAYER_BUTTON;

// Slab colour for a given button, taken from what was actually drawn.
// Matched on y as well as x: buttons stacked on a menu share both x and width,
// so x alone cannot tell them apart. The shadow is the black rect at the same
// spot; the slab is the coloured one.
function slabFillFor(button) {
  const near = rects.filter((r) =>
    r.kind === "rect" && r.w === button.w &&
    Math.abs(r.x - button.x) < 0.01 &&
    Math.abs(r.y - button.y) <= sandbox.BUTTON_LIFT + 0.01);
  const slab = near.find((r) => r.fill && !(r.fill.length === 4 && r.fill[0] === 0 && r.fill[1] === 0 && r.fill[2] === 0));
  return slab ? slab.fill : null;
}

frame();
const idle = slabFillFor(BTN);
check("button draws with the idle colour", JSON.stringify(idle) === JSON.stringify(sandbox.BUTTON_PRIMARY.idle), JSON.stringify(idle));
check("cursor is default with no hover", canvasStyle.cursor === "default", canvasStyle.cursor);

listeners.pointermove(at(BTN));
frame();
check("hovering lightens the button", JSON.stringify(slabFillFor(BTN)) === JSON.stringify(sandbox.BUTTON_PRIMARY.hover));
check("hovering sets a pointer cursor", canvasStyle.cursor === "pointer");
check("the other button stays idle", JSON.stringify(slabFillFor(OTHER)) === JSON.stringify(sandbox.BUTTON_PRIMARY.idle));

listeners.pointerdown(at(BTN));
check("pressing records the button", sandbox.pressedButton === BTN);
sandbox.gameState = sandbox.MENU;   // the click also starts a run; stay on the menu to observe
sandbox.menuSinglePlayerRequested = false;
frame();
check("pressed button darkens", JSON.stringify(slabFillFor(BTN)) === JSON.stringify(sandbox.BUTTON_PRIMARY.press));

// Releasing anywhere at all must clear the press, or it sticks down forever.
sandbox.onPointerRelease();
frame();
check("release clears the pressed state", sandbox.pressedButton === null);

listeners.pointerleave();
frame();
check("leaving the canvas clears hover", JSON.stringify(slabFillFor(BTN)) === JSON.stringify(sandbox.BUTTON_PRIMARY.idle));
check("leaving restores the default cursor", canvasStyle.cursor === "default");

// Touch must never leave a button looking hovered.
listeners.pointermove({ clientX: BTN.x, clientY: BTN.y, pointerType: "touch" });
frame();
check("touch does not produce a hover", JSON.stringify(slabFillFor(BTN)) === JSON.stringify(sandbox.BUTTON_PRIMARY.idle));

// Every screen's button list must match what that screen draws, or presses
// land on buttons that aren't there.
const screens = [
  ["MENU", sandbox.MENU], ["MULTIPLAYER_MENU", sandbox.MULTIPLAYER_MENU],
  ["MULTIPLAYER_JOIN_ENTRY", sandbox.MULTIPLAYER_JOIN_ENTRY],
  ["MULTIPLAYER_WAITING", sandbox.MULTIPLAYER_WAITING],
  ["MULTIPLAYER_COUNTDOWN", sandbox.MULTIPLAYER_COUNTDOWN],
  ["MULTIPLAYER_RESULT", sandbox.MULTIPLAYER_RESULT],
  ["END", sandbox.END],
];
let listsMatch = true;
const mismatches = [];
for (const [name, state] of screens) {
  sandbox.gameState = state;
  sandbox.mpRoomCode = "AB12";
  frame();
  const declared = sandbox.buttonsOnScreen();
  // A button is "drawn" if a slab of its width appeared centred on its x.
  for (const b of declared) {
    const found = rects.some((r) => r.kind === "rect" && Math.abs(r.x - b.x) < 0.01 && r.w === b.w);
    if (!found) { listsMatch = false; mismatches.push(name + " declares a button it never draws"); }
  }
  if (declared.length === 0 && state !== sandbox.PLAY) {
    // fine - some screens legitimately have none
  }
}
check("declared buttons match drawn buttons", listsMatch, mismatches.join("; "));

// Overlays that only appear in a particular state, and so are easy to ship
// broken: every p5 constant and call in them must actually exist.
function drawsWithoutThrowing(label, setUp) {
  try {
    setUp();
    frame();
    check(label, true);
  } catch (e) {
    check(label, false, e.message);
  }
}

drawsWithoutThrowing("mute control draws", () => {
  sandbox.gameState = sandbox.PLAY;
  sandbox.soundMuted = true;
});
drawsWithoutThrowing("paused overlay draws", () => {
  sandbox.gameState = sandbox.PAUSED;
});
drawsWithoutThrowing("mute control draws at night", () => {
  sandbox.gameState = sandbox.PLAY;
  sandbox.nightAmount = 1;
});
sandbox.soundMuted = false;
sandbox.nightAmount = 0;

// The whole UI is pixel-art arcade: square corners, ink keylines. A rounded
// rect anywhere in it is a web form control wearing the wrong clothes, and it
// only takes one to make the screen look like a mistake rather than a style.
{
  const rounded = [];
  for (const [name, state] of screens) {
    sandbox.gameState = state;
    sandbox.mpRoomCode = "AB12";
    frame();
    for (const r of rects) {
      if (r.kind === "rect" && r.r !== undefined) rounded.push(name + " @" + r.x + "," + r.y);
    }
  }
  check("no rounded corners anywhere in the UI", rounded.length === 0, rounded.join("; "));
}

// Every card is the same plate: an ink keyline rect with the body rect drawn
// inside it, 6px smaller in both directions. Screens used to roll their own,
// each with a different radius and a different grey.
{
  const missingFrame = [];
  const cards = [
    ["multiplayer menu", sandbox.MULTIPLAYER_MENU, sandbox.OVERLAY_PANEL.w, sandbox.OVERLAY_PANEL.h],
    ["paused", sandbox.PAUSED, 260, 74],
  ];
  for (const [name, state, w, h] of cards) {
    sandbox.gameState = state;
    frame();
    const body = rects.some((r) => r.kind === "rect" && r.w === w && r.h === h);
    const frameRect = rects.some((r) => r.kind === "rect" && r.w === w + 6 && r.h === h + 6);
    if (!body || !frameRect) missingFrame.push(name);
  }
  check("every card is drawn as a keylined plate", missingFrame.length === 0, missingFrame.join("; "));
}

// Mute and pause were keyboard-only, so on a phone neither existed at all.
{
  const tap = (button) => {
    const point = { clientX: button.x, clientY: button.y, pointerType: "touch" };
    listeners.pointerdown(point);
    sandbox.touchStarted({ touches: [point] });
  };

  sandbox.mpIsRacing = false;
  sandbox.gameState = sandbox.PLAY;
  sandbox.soundMuted = false;
  sandbox.touchIsDown = false;
  frame();

  // A tap on a control is doing that and nothing else: on this screen it
  // would otherwise also jump, and on the game-over screen it would retry.
  tap(sandbox.MUTE_BUTTON);
  check("tapping mute does not also jump", sandbox.touchIsDown === false);
  frame();
  check("tapping mute mutes", sandbox.soundMuted === true);

  sandbox.touchIsDown = false;
  tap(sandbox.MUTE_BUTTON);
  frame();
  check("tapping mute again unmutes", sandbox.soundMuted === false);

  sandbox.touchIsDown = false;
  tap(sandbox.PAUSE_BUTTON);
  check("tapping pause does not also jump", sandbox.touchIsDown === false);
  frame();
  check("tapping pause pauses", sandbox.gameState === sandbox.PAUSED);
  sandbox.touchIsDown = false;
  tap(sandbox.PAUSE_BUTTON);
  frame();
  check("tapping pause again resumes", sandbox.gameState === sandbox.PLAY);

  // A tap anywhere else still plays the game.
  sandbox.touchIsDown = false;
  sandbox.touchStarted({ touches: [{ clientX: 300, clientY: 40 }] });
  check("tapping the playfield still jumps", sandbox.touchIsDown === true);
  sandbox.touchIsDown = false;

  // Pausing a race would be a free timeout - the opponent keeps running on
  // their own machine - so the control is not offered during one.
  sandbox.mpIsRacing = true;
  frame();
  check("no pause control during a race",
    sandbox.hudControlsOnScreen().indexOf(sandbox.PAUSE_BUTTON) === -1);
  sandbox.pauseRequested = true;
  frame();
  check("a race cannot be paused anyway", sandbox.gameState === sandbox.PLAY);
  sandbox.mpIsRacing = false;
  sandbox.pauseRequested = false;

  // Mute outlives any one screen; pause only means something inside a run.
  sandbox.gameState = sandbox.MENU;
  frame();
  check("mute is offered on the menu too",
    sandbox.hudControlsOnScreen().indexOf(sandbox.MUTE_BUTTON) !== -1);
  check("pause is not offered on the menu",
    sandbox.hudControlsOnScreen().indexOf(sandbox.PAUSE_BUTTON) === -1);

  // Typing a room code containing M must still not toggle mute - but a tap on
  // the button is unambiguous and skips that guard.
  sandbox.gameState = sandbox.MULTIPLAYER_JOIN_ENTRY;
  sandbox.document.activeElement = sandbox.roomCodeInputElt;
  sandbox.soundMuted = false;
  tap(sandbox.MUTE_BUTTON);
  frame();
  check("tapping mute works while typing a code", sandbox.soundMuted === true);
  sandbox.document.activeElement = null;
  sandbox.soundMuted = false;
  sandbox.touchIsDown = false;
}

// Score HUD. The live score is five zeros on every screen that has no run
// behind it, which is a number saying nothing - it is only shown once there
// is a run to count.
{
  //the screens loop above leaves a race in progress, and a race replaces this
  //HUD outright - see inRaceView()
  sandbox.mpIsRacing = false;
  sandbox.gameState = sandbox.MENU;
  sandbox.highScore = 1234;
  sandbox.runStartHighScore = 1234;
  sandbox.score = 0;
  frame();
  check("menu HUD shows the record", drewText("HI 01234"));
  check("menu HUD hides the empty live score", !drewText("00000"));

  sandbox.gameState = sandbox.PLAY;
  sandbox.score = 42;
  frame();
  check("playing HUD shows the record", drewText("HI 01234"));
  check("playing HUD shows the live score", drewText("00042"));

  // Beating the record swaps the label. The record itself is already climbing
  // live at this point, so the badge cannot be driven off highScore.
  sandbox.score = 1300;
  sandbox.highScore = 1300;
  frame();
  check("beating the record is called out", drewText("NEW BEST"));
  check("the beaten record line is replaced", !drewText("HI 01300"));

  // Tabbing away mid-run persists the new best, which used to be the only
  // record of where the run started - the badge would disappear on return.
  sandbox.persistHighScore();
  frame();
  check("the badge survives a mid-run save", drewText("NEW BEST"));

  // A first-ever run has no record to beat, so nothing is being called out.
  sandbox.runStartHighScore = 0;
  frame();
  check("a first run claims no record", !drewText("NEW BEST"));
}

// Passing a hundred is audible; it has to be visible too, for anyone playing
// with the sound off.
{
  sandbox.gameState = sandbox.PLAY;
  sandbox.score = 0;
  sandbox.nextScoreMilestone = 1;
  clock += 16; sandbox.draw();
  check("a milestone starts a flash", sandbox.scoreFlashStrength() > 0, String(sandbox.scoreFlashStrength()));
  clock += sandbox.SCORE_FLASH_MS;
  check("the flash fades out", sandbox.scoreFlashStrength() === 0, String(sandbox.scoreFlashStrength()));
  sandbox.nextScoreMilestone = sandbox.SCORE_MILESTONE_INTERVAL;
}

// Race lead gauge. A signed integer tells you the gap but not how big a gap
// that is; a needle off centre says "just ahead" without being read.
{
  const H = sandbox.RACE_HUD_GAUGE_H;
  const W = sandbox.RACE_HUD_GAUGE_W;
  const track = () => rects.find((r) => r.kind === "rect" && r.h === H && r.w === W);
  const bar = () => rects.find((r) => r.kind === "rect" && r.h === H && r.w !== W && r.w > 0 &&
    (JSON.stringify(r.fill) === JSON.stringify(sandbox.PANEL_GOOD) ||
     JSON.stringify(r.fill) === JSON.stringify(sandbox.PANEL_BAD)));

  function race(selfScore, theirScore, opts) {
    sandbox.mpIsRacing = true;
    sandbox.gameState = sandbox.PLAY;
    sandbox.mpOpponentLeft = (opts && opts.left) || false;
    sandbox.mpOpponentFinished = false;
    sandbox.mpOpponentLiveScore = theirScore;
    sandbox.score = selfScore;
    //the scoreboard is drawn after the frame's own score tick, so no time may
    //pass in it - the lead on screen is then exactly the one set up here
    sandbox.lastFrameMillis = clock + 16;
    frame();
  }

  race(500, 500);
  check("a level race draws the gauge track", !!track());
  check("a level race fills neither side", !bar());
  check("a level race says so", drewText("LEVEL"));

  race(560, 500);
  const ahead = bar();
  check("being ahead fills the gauge", !!ahead);
  check("ahead fills to the right of centre", ahead && ahead.x > track().x, ahead && String(ahead.x));
  check("ahead fills green", ahead && JSON.stringify(ahead.fill) === JSON.stringify(sandbox.PANEL_GOOD));
  check("ahead is also stated", drewText("+60 AHEAD"));

  race(440, 500);
  const behind = bar();
  check("behind fills to the left of centre", behind && behind.x < track().x, behind && String(behind.x));
  check("behind fills red", behind && JSON.stringify(behind.fill) === JSON.stringify(sandbox.PANEL_BAD));
  check("behind is also stated", drewText("-60 BEHIND"));

  // The bar has to stop at the end of its track rather than growing past it.
  race(500 + sandbox.RACE_GAUGE_FULL_LEAD * 8, 500);
  const pinned = bar();
  check("a runaway lead pins the gauge at full", pinned && Math.abs(pinned.w - W / 2) < 0.01,
    pinned && String(pinned.w));

  // Before the opponent has reported anything there is no gap to show, and
  // after a forfeit the gap grows against a number that stopped moving.
  race(500, null);
  check("no gauge before the opponent reports", !track());
  race(500, 400, { left: true });
  check("no gauge after a forfeit", !track());
  check("a forfeit is stated instead", drewText("THEM  LEFT"));

  sandbox.mpIsRacing = false;
  sandbox.mpOpponentLeft = false;
  sandbox.mpOpponentLiveScore = null;
}

// Game over stats. The plate must sit ABOVE the GAME OVER art, never behind
// it: those sprites are dark pixels outlined in white at night so they read
// against a dark background, and ink under them would hide them in daylight.
{
  sandbox.mpIsRacing = false;
  sandbox.gameState = sandbox.END;
  sandbox.score = 820;
  sandbox.highScore = 1450;
  sandbox.runStartHighScore = 1450;
  frame();
  check("game over states the run's score", drewText("SCORE 00820"));
  check("game over states the record", drewText("BEST 01450"));

  const plate = rects.find((r) => r.kind === "rect" && r.w === 300 && r.h === 42);
  const artTop = sandbox.gameOver.y - (sandbox.gameOver.height * sandbox.gameOver.scale) / 2;
  check("the stats plate clears the game over art",
    plate && plate.y + plate.h / 2 < artTop, plate && (plate.y + plate.h / 2) + " vs " + artTop);

  sandbox.score = 1600;
  sandbox.highScore = 1600;
  frame();
  check("a record run says so instead of repeating the best", drewText("NEW RECORD"));
  check("the beaten best is not also shown", !drewText("BEST 01600"));
}

// Layering. The world - ground line, clouds, cacti - is painted first and
// every screen's interface on top of it. It used to be the other way round:
// the ground line ran through every button, and clouds drifted across the
// result panel and the game-over card, over the very scores they show.
{
  const WORLD = { kind: "sprites" };
  const realDrawSprites = sandbox.drawSprites;
  sandbox.drawSprites = () => rects.push(WORLD);
  const slabIndex = (button) => rects.findIndex((r) =>
    r.kind === "rect" && r.w === button.w && r.h === button.h &&
    Math.abs(r.x - button.x) < 0.01 && Math.abs(r.y - button.y) <= sandbox.BUTTON_LIFT + 0.01);

  sandbox.mpIsRacing = false;
  const screens = [
    ["menu", sandbox.MENU, sandbox.MENU_SINGLE_PLAYER_BUTTON],
    ["multiplayer menu", sandbox.MULTIPLAYER_MENU, sandbox.MULTIPLAYER_CREATE_BUTTON],
    ["game over", sandbox.END, sandbox.END_MENU_BUTTON],
  ];
  for (const [name, state, button] of screens) {
    sandbox.gameState = state;
    sandbox.restartKeyWasDown = true;
    frame();
    const world = rects.indexOf(WORLD);
    const slab = slabIndex(button);
    check("the " + name + " buttons draw over the world", world !== -1 && slab > world,
      "world " + world + ", button " + slab);
  }
  sandbox.gameState = sandbox.MENU;
  frame();

  // Paused on a screen taller than the strip, which is every phone and most
  // monitors: the dim has to reach the extra sky and sand too, not stop at the
  // strip's edges and leave the paused game framed in a dark band.
  const savedHeight = sandbox.height;
  const savedOffset = sandbox.viewOffsetY;
  sandbox.height = 400;
  sandbox.viewOffsetY = 120;
  sandbox.gameState = sandbox.PAUSED;
  frame();
  const dimIndex = rects.findIndex((r) => r.kind === "rect" && r.fill &&
    r.fill.length === 4 && r.fill[3] === 120 && r.fill[0] === 0);
  const dim = rects[dimIndex];
  check("pausing dims the whole screen", dim && dim.w === 600 && dim.h === 400,
    dim && dim.w + "x" + dim.h);
  check("the dim is centred on the canvas, not the strip",
    dim && dim.y === 400 / 2 - 120, dim && String(dim.y));
  // The play button is the only way a phone player can resume, so it must
  // not be dimmed along with everything else.
  check("the resume button draws above the dim", dimIndex !== -1 && slabIndex(sandbox.PAUSE_BUTTON) > dimIndex,
    "dim " + dimIndex + ", button " + slabIndex(sandbox.PAUSE_BUTTON));
  sandbox.height = savedHeight;
  sandbox.viewOffsetY = savedOffset;

  // GAME OVER and the restart icon are sprites, sorted by depth among
  // everything else. Every cloud takes a depth above the last, so a run of a
  // few seconds was enough to put clouds in front of the words.
  sandbox.gameState = sandbox.PLAY;
  sandbox.trex.depth = 40;
  sandbox.cloudsGroup.add(Object.assign(sandbox.createSprite(300, 100, 40, 10), { depth: 39 }));
  sandbox.obstaclesGroup.add(Object.assign(sandbox.createSprite(300, 160, 10, 40), { depth: 44 }));
  const realHit = sandbox.trexHitsAnyObstacle;
  sandbox.trexHitsAnyObstacle = () => true;
  frame();
  sandbox.trexHitsAnyObstacle = realHit;
  check("a crash reaches game over", sandbox.gameState === sandbox.END, "state " + sandbox.gameState);
  check("the game over art sorts above the world", sandbox.gameOver.depth > 44, String(sandbox.gameOver.depth));
  check("the restart icon sorts above the world", sandbox.restart.depth > 44, String(sandbox.restart.depth));
  sandbox.obstaclesGroup.removeSprites();
  sandbox.cloudsGroup.removeSprites();

  sandbox.drawSprites = realDrawSprites;
  sandbox.gameState = sandbox.MENU;
  frame();
}

// On the game over screen every tap counts as "restart" - that is what makes
// tapping anywhere retry - so a tap on the MENU button is two things at once.
// The END branch resolves it by consuming both in the same frame, with MENU
// last and therefore winning. That is easy to break by moving either check,
// and breaking it is not obvious: it would restart the run under the finger
// that asked to leave, and strand a request for the next game over to act on.
{
  function tapAt(button) {
    const point = { clientX: button.x, clientY: button.y, pointerType: "touch" };
    listeners.pointerdown(point);
    sandbox.touchStarted({ touches: [point] });
  }

  sandbox.mpIsRacing = false;
  sandbox.gameState = sandbox.END;
  sandbox.restartKeyWasDown = false;
  sandbox.touchIsDown = false;
  sandbox.restartRequested = false;
  sandbox.endMenuRequested = false;
  frame();

  tapAt(sandbox.END_MENU_BUTTON);
  clock += 16; rects.length = 0; texts.length = 0; sandbox.draw();
  check("tapping MENU on game over reaches the menu",
    sandbox.gameState === sandbox.MENU, "state " + sandbox.gameState);
  check("tapping MENU leaves no request behind", sandbox.endMenuRequested === false);

  // And the next game over must not act on anything left over from it.
  sandbox.touchIsDown = false;
  sandbox.gameState = sandbox.END;
  sandbox.restartKeyWasDown = false;
  frame();
  check("the next game over stays put", sandbox.gameState === sandbox.END,
    "state " + sandbox.gameState);

  // A tap anywhere else on that screen must still retry - it is the whole
  // point of the screen.
  sandbox.touchIsDown = false;
  sandbox.restartKeyWasDown = false;
  frame();
  sandbox.touchStarted({ touches: [{ clientX: 80, clientY: 40 }] });
  clock += 16; sandbox.draw();
  check("tapping elsewhere still retries", sandbox.gameState === sandbox.PLAY,
    "state " + sandbox.gameState);
  sandbox.touchIsDown = false;
}

// Race result. The margin gauge is the race HUD's own gauge frozen at the
// final gap - two five-digit numbers make you subtract to find out whether it
// was close.
{
  const gauge = () => rects.find((r) => r.kind === "rect" &&
    r.w === sandbox.RACE_HUD_GAUGE_W && r.h === sandbox.RACE_HUD_GAUGE_H);
  function result(opts) {
    sandbox.gameState = sandbox.MULTIPLAYER_RESULT;
    //suppresses the corner race HUD's own gauge, so only the panel's is left
    sandbox.mpOpponentLiveScore = null;
    sandbox.mpConnectionLost = (opts && opts.lost) || false;
    sandbox.mpOpponentLeft = (opts && opts.left) || false;
    sandbox.mpOpponentFinished = opts && opts.pending ? false : true;
    sandbox.mpSelfScore = (opts && opts.self) !== undefined ? opts.self : 900;
    sandbox.mpOpponentScore = (opts && opts.them) !== undefined ? opts.them : 800;
    frame();
  }

  result({ self: 900, them: 800 });
  check("a decided result shows the final margin", !!gauge());
  check("the verdict is set twice, ink under colour",
    texts.filter((t) => t.str === "YOU WIN").length === 2,
    String(texts.filter((t) => t.str === "YOU WIN").length));

  result({ pending: true });
  check("no margin while the opponent is still running", !gauge());
  result({ left: true });
  check("no margin after a forfeit", !gauge());
  result({ lost: true });
  check("no margin when the race could not be scored", !gauge());

  sandbox.mpConnectionLost = false;
  sandbox.mpOpponentLeft = false;
}

// Room code tiles. A code is read down a phone line, so each character gets
// its own tile - as one run of big text, O/0 and I/1 are a coin toss.
{
  //the faces, not the shadows drawn underneath them at the same size
  const tileFaces = () => rects.filter((r) =>
    r.kind === "rect" && r.w === sandbox.CODE_TILE_W && r.h === sandbox.CODE_TILE_H &&
    !(r.fill && r.fill.length === 4));
  const isLit = (r) => JSON.stringify(r.fill) === JSON.stringify(sandbox.BUTTON_PRIMARY.idle);

  sandbox.gameState = sandbox.MULTIPLAYER_WAITING;
  sandbox.mpRoomCode = "AB12";
  frame();
  const faces = tileFaces();
  check("the code gets one tile per character", faces.length === 4, String(faces.length));
  check("every character is set on its own", ["A", "B", "1", "2"].every((c) => drewText(c)));
  //the share link below the tiles legitimately contains the code, so this has
  //to be an exact match rather than a substring one
  check("the code is not also set as one word", !texts.some((t) => t.str === "AB12"));

  const xs = faces.map((r) => r.x).sort((a, b) => a - b);
  const gaps = xs.slice(1).map((x, i) => x - xs[i]);
  check("tiles are evenly spaced", gaps.every((g) => Math.abs(g - gaps[0]) < 0.01), gaps.join(","));
  check("the row is centred on the panel",
    Math.abs((xs[0] + xs[3]) / 2 - sandbox.OVERLAY_PANEL.x) < 0.01, xs.join(","));
  check("a filled code lights no tile", faces.every((r) => !isLit(r)));

  // Connecting shows the same row empty, with one tile lit and travelling -
  // the code's own shape, visibly waiting to be filled in.
  sandbox.mpRoomCode = null;
  const litIndexes = new Set();
  for (let step = 0; step < 4; step++) {
    clock += sandbox.CONNECT_TILE_STEP_MS;
    frame();
    const waiting = tileFaces();
    if (waiting.length !== 4) { litIndexes.add("count:" + waiting.length); continue; }
    const lit = waiting.filter(isLit);
    if (lit.length !== 1) { litIndexes.add("lit:" + lit.length); continue; }
    litIndexes.add(waiting.map((r) => r.x).sort((a, b) => a - b).indexOf(lit[0].x));
  }
  check("connecting lights exactly one tile at a time", ![...litIndexes].some((v) => typeof v === "string"),
    [...litIndexes].join(","));
  check("the lit tile travels along the row", litIndexes.size === 4, [...litIndexes].join(","));
  sandbox.mpRoomCode = "AB12";
}

// The menu is an attract screen: the world runs behind it. It must run
// without touching anything a real run counts, and it must stop the moment
// the player leaves for a screen that shows a still world.
{
  sandbox.gameState = sandbox.MENU;
  sandbox.score = 0;
  sandbox.distanceTravelled = 0;
  sandbox.ground.x = 500;
  frame();
  check("menu scrolls the ground", sandbox.ground.velocityX < 0, String(sandbox.ground.velocityX));
  check("menu scrolls slower than a run opens at",
    Math.abs(sandbox.ground.velocityX) < sandbox.BASE_SPEED, String(sandbox.ground.velocityX));
  frame(); frame();
  check("menu costs the run no score", sandbox.score === 0, String(sandbox.score));
  check("menu costs the run no distance", sandbox.distanceTravelled === 0, String(sandbox.distanceTravelled));
  check("menu spawns no obstacles", sandbox.obstaclesGroup.length === 0, String(sandbox.obstaclesGroup.length));

  //the ground wraps rather than scrolling off to the left forever
  sandbox.ground.x = -1;
  frame();
  check("menu ground wraps around", sandbox.ground.x > 0, String(sandbox.ground.x));

  sandbox.menuMultiplayerRequested = true;
  frame();
  check("leaving the menu reaches the lobby", sandbox.gameState === sandbox.MULTIPLAYER_MENU);
  check("leaving the menu stops the ground", sandbox.ground.velocityX === 0, String(sandbox.ground.velocityX));
  frame();
  check("the lobby world stays still", sandbox.ground.velocityX === 0, String(sandbox.ground.velocityX));
}

// The attract prompt blinks. Both phases have to actually occur, and neither
// may be fully transparent - a prompt that disappears outright on a screen
// this small reads as a fault rather than as a blink.
{
  const phases = new Set();
  for (let t = 0; t < sandbox.MENU_BLINK_MS * 2; t += 50) { clock = t; phases.add(sandbox.menuBlinkAlpha()); }
  check("attract prompt blinks between two shades", phases.size === 2, [...phases].join(","));
  check("attract prompt never blinks fully out", [...phases].every((a) => a > 0), [...phases].join(","));
}

// The waiting dots have to actually cycle, or they are just a static string.
const seen = new Set();
for (let t = 0; t < 2000; t += 100) { clock = t; seen.add(sandbox.waitingDots()); }
check("waiting dots animate", seen.size === 4, [...seen].map((s) => '"' + s + '"').join(","));

// Every overlay screen must render without throwing, in each of its variants.
const variants = [
  ["multiplayer menu", () => { sandbox.gameState = sandbox.MULTIPLAYER_MENU; sandbox.mpConnectionMessage = "Room not found."; }],
  ["waiting, connecting", () => { sandbox.gameState = sandbox.MULTIPLAYER_WAITING; sandbox.mpRoomCode = null; }],
  ["waiting, with a code", () => { sandbox.mpRoomCode = "AB12"; }],
  ["join entry", () => { sandbox.gameState = sandbox.MULTIPLAYER_JOIN_ENTRY; }],
  ["countdown", () => { sandbox.gameState = sandbox.MULTIPLAYER_COUNTDOWN; sandbox.mpRaceStartMillis = clock + 2500; }],
  ["result, waiting", () => { sandbox.gameState = sandbox.MULTIPLAYER_RESULT; sandbox.mpOpponentFinished = false; }],
  ["result, win", () => { sandbox.mpOpponentFinished = true; sandbox.mpSelfScore = 900; sandbox.mpOpponentScore = 400; }],
  ["result, loss", () => { sandbox.mpSelfScore = 100; sandbox.mpOpponentScore = 400; }],
  ["result, dead heat", () => { sandbox.mpSelfScore = 400; sandbox.mpOpponentScore = 400; }],
  ["result, forfeit", () => { sandbox.mpOpponentLeft = true; sandbox.mpOpponentScore = null; }],
  ["result, connection lost", () => { sandbox.mpOpponentLeft = false; sandbox.mpConnectionLost = true; }],
];
for (const [label, setUp] of variants) drawsWithoutThrowing(label, setUp);



// --- Controls hint: must appear for a newcomer and vanish once they jump.
(function () {
  sandbox.gameState = sandbox.PLAY;
  sandbox.playerHasJumped = false;
  sandbox.runStartedMillis = clock;
  check("hint is visible at the start of a run", sandbox.controlsHintAlpha() === 1);

  clock += 5500;
  const fading = sandbox.controlsHintAlpha();
  check("hint fades before it disappears", fading > 0 && fading < 1, String(fading));

  clock += 1000;
  check("hint times out as a backstop", sandbox.controlsHintAlpha() === 0);

  // A player who jumps immediately should not keep seeing it.
  sandbox.runStartedMillis = clock;
  check("hint returns for a fresh run", sandbox.controlsHintAlpha() === 1);
  sandbox.playerHasJumped = true;
  check("jumping dismisses the hint at once", sandbox.controlsHintAlpha() === 0);

  // ...and it must stay dismissed on later runs, not nag every time.
  sandbox.runStartedMillis = clock;
  check("hint stays gone on later runs", sandbox.controlsHintAlpha() === 0);

  sandbox.playerHasJumped = false;
  sandbox.runStartedMillis = clock;
  try { frame(); check("hint renders without throwing", true); }
  catch (e) { check("hint renders without throwing", false, e.message); }
  sandbox.playerHasJumped = true;
})();

// --- The joiner's lobby. Host and joiner share the waiting screen while the
// socket connects, but only the host is waiting for anyone, and only the host
// has a room worth sharing: a joiner's link could only send a third person to
// a room that is about to be full.
(function () {
  const labels = () => sandbox.buttonsOnScreen();
  sandbox.gameState = sandbox.MULTIPLAYER_WAITING;
  sandbox.mpRoomCode = "AB12";
  sandbox.mpJoining = false;
  frame();
  check("the host is waiting for an opponent", drewText("WAITING FOR OPPONENT"));
  check("the host can copy the invite link", labels().indexOf(sandbox.WAITING_COPY_BUTTON) !== -1);

  sandbox.mpJoining = true;
  frame();
  check("a joiner is told they are joining", drewText("JOINING ROOM"));
  check("a joiner is not told to wait for an opponent", !drewText("WAITING FOR OPPONENT"));
  check("a joiner has no link to copy", labels().indexOf(sandbox.WAITING_COPY_BUTTON) === -1 &&
    labels().indexOf(sandbox.MULTIPLAYER_LEAVE_BUTTON) !== -1);
  check("a joiner is not shown the invite link", !texts.some((t) => t.str.indexOf("?room=") !== -1));
  check("a joiner still sees the code they are joining", ["A", "B", "1", "2"].every((c) => drewText(c)));

  // A slow server is as likely to keep a joiner waiting as a host, and the
  // explanation used to be shown only to the host.
  sandbox.mpSocket = { readyState: 0 };
  sandbox.mpSocketOpen = false;
  sandbox.mpConnectStartedMillis = clock - sandbox.MP_CONNECT_SLOW_MS - 100;
  frame();
  check("a joiner is told the server may be waking", drewText("WAKING UP"));

  // And the flag must not outlive the attempt, or the next room this player
  // hosts would hide its own invite link.
  sandbox.mpSocket = null;
  sandbox.mpDisconnect();
  check("leaving clears the joining flag", sandbox.mpJoining === false);
  sandbox.mpJoinRoom("CD34");
  check("joining by code sets it", sandbox.mpJoining === true);
  sandbox.mpDisconnect();
  sandbox.mpConnectionMessage = null;
  sandbox.gameState = sandbox.MENU;
})();

// --- Prompts name the controls the player actually has. A phone has no P,
// R, 1, 2 or F, and on the pause screen the old wording was the only
// instruction given - one a phone player could not follow.
(function () {
  const prompt = () => texts.find((t) => t.str.indexOf("PRESS 1 OR 2") !== -1);

  sandbox.playerIsOnTouch = false;
  sandbox.gameState = sandbox.MENU;
  frame();
  check("a keyboard player is told the shortcuts", !!prompt());
  // The ground art spans y 174-186 with pebbles in it, which broke the
  // letters up when the prompt sat on it.
  check("the shortcut prompt sits below the ground art", prompt() && prompt().y - prompt().size / 2 > 186,
    prompt() && String(prompt().y));
  sandbox.playerIsOnTouch = true;
  frame();
  check("a touch player is not told about keys", !prompt());

  sandbox.gameState = sandbox.PAUSED;
  sandbox.playerIsOnTouch = false;
  frame();
  check("keyboard pause says press P", drewText("PRESS P TO RESUME"));
  sandbox.playerIsOnTouch = true;
  frame();
  check("touch pause points at the play button", drewText("TAP THE PLAY BUTTON") && !drewText("PRESS P"));

  sandbox.gameState = sandbox.MULTIPLAYER_RESULT;
  sandbox.mpSocket = { readyState: 1, send: noop, close: noop };
  sandbox.WebSocket = { OPEN: 1 };
  sandbox.mpConnectionLost = false;
  sandbox.mpOpponentLeft = false;
  sandbox.mpOpponentPresent = true;
  sandbox.mpOpponentFinished = true;
  sandbox.mpRematchRequested = false;
  sandbox.mpSelfScore = 500;
  sandbox.mpOpponentScore = 400;
  sandbox.playerIsOnTouch = false;
  frame();
  check("keyboard rematch names its key", drewText("REMATCH (R)"));
  sandbox.playerIsOnTouch = true;
  frame();
  check("touch rematch does not", drewText("REMATCH") && !drewText("(R)"));

  sandbox.mpSocket = null;
  sandbox.playerIsOnTouch = false;
  sandbox.gameState = sandbox.MENU;
})();

// --- Rotate hint. Upright, a phone shows the game as a strip about 390px
// wide with most of the screen empty; the hint says so in that empty sky.
(function () {
  const hinted = () => drewText("TURN SIDEWAYS");
  function portraitPhone() {
    sandbox.window.innerWidth = 390;
    sandbox.window.innerHeight = 844;
    //the canvas height fillScreen() asks for at that shape - the stubbed
    //resizeCanvas cannot apply it, so it is set up front
    sandbox.height = Math.round(600 * 844 / 390);
  }
  function landscape() {
    sandbox.window.innerWidth = 844;
    sandbox.window.innerHeight = 390;
    sandbox.height = Math.round(600 * 390 / 844);
  }

  portraitPhone();
  sandbox.playerIsOnTouch = true;
  sandbox.gameState = sandbox.MENU;
  frame();
  check("an upright phone is told to turn sideways", hinted());
  const heading = texts.find((t) => t.str === "TURN SIDEWAYS");
  // At a portrait phone's scale of about 0.65, anything much under 16 game
  // units is too small to read comfortably - which is the whole problem.
  check("the hint is set large enough to read", heading && heading.size >= 18, heading && String(heading.size));
  check("the hint sits in the sky above the strip", heading && heading.y < sandbox.viewOffsetY,
    heading && heading.y + " vs " + sandbox.viewOffsetY);

  sandbox.gameState = sandbox.PLAY;
  sandbox.trexHitsAnyObstacle = () => false;
  frame();
  check("the hint never shows during a run", !hinted());
  sandbox.gameState = sandbox.MENU;

  sandbox.playerIsOnTouch = false;
  frame();
  check("a narrow desktop window gets no hint", !hinted());
  sandbox.playerIsOnTouch = true;

  landscape();
  frame();
  check("a sideways phone gets no hint", !hinted());

  delete sandbox.window.innerWidth;
  delete sandbox.window.innerHeight;
  sandbox.height = 200;
  sandbox.playerIsOnTouch = false;
  frame();
})();

console.log("");
console.log(failures === 0 ? "ALL PASS" : failures + " FAILED");
process.exit(failures === 0 ? 0 : 1);
