var PLAY = 1;
var END = 0;
var PAUSED = 2;
var MENU = 3;
var MULTIPLAYER_MENU = 4;
var MULTIPLAYER_WAITING = 5;
var MULTIPLAYER_JOIN_ENTRY = 6;
var MULTIPLAYER_COUNTDOWN = 7;
var MULTIPLAYER_RESULT = 8;
var gameState = MENU;

var trex, trex_running, trex_collided;
var ground, invisibleGround, groundImage;

var cloudsGroup, cloudImage;
var obstaclesGroup, obstacle1, obstacle2, obstacle3, obstacle4, obstacle5, obstacle6;

var score = 0;

var gameOver, restart;

var touchIsDown = false;
var touchDuckIsDown = false;

// Physics/spawning below is expressed in "units per 60fps reference frame"
// and rescaled every draw() call by dtFactor so gameplay speed, jump height
// and spawn rate stay identical whether the display runs at 60Hz, 144Hz or 240Hz.
var trexVY = 0;
var lastFrameMillis = 0;

// Global slow-motion factor - this is the knob to turn for overall pace.
// It scales time itself, so scrolling, gravity, the jump arc and the score
// all slow down together. Lowering the scroll speed on its own would NOT
// work: the jump lasts a fixed 30 frames, so a slower world means the trex
// lands on top of the wider cacti instead of clearing them.
var TIME_SCALE = 0.5;

// Scroll speed, how much faster it gets as the score climbs, and a ceiling
// so it never runs away. These are in "per 60fps reference frame" units,
// before TIME_SCALE is applied. BASE_SPEED stays at the original 6 so the
// jump arc still clears the widest cactus; TIME_SCALE does the slowing down.
var BASE_SPEED = 6;
var SPEED_PER_100_SCORE = 0.1;
var MAX_SPEED = 12;
var CLOUD_SPEED = 3;

// Jump impulse. At -12 the trex is only high enough to clear the widest
// cactus for ~21 frames while that cactus overlaps it for ~20, leaving
// almost no margin for error; -13.5 opens that up to a fair window.
var JUMP_VELOCITY = -13.5;
var GRAVITY = 0.8;

// Extra downward pull for the fast-fall keys, used while airborne.
var FAST_FALL_ACCEL = 1.6;

// Variable jump height, like Chrome's dino: hold the jump key to go higher,
// tap it for a short hop that lands sooner. Letting go while the trex is still
// rising caps how fast it may keep climbing, cutting the arc short.
//
// Expressed as a CEILING on upward speed rather than a one-off multiply when
// the key is released, because a multiply would be applied once per frame and
// so would scale with the display: a 240Hz screen would apply it four times as
// often as a 60Hz one and stamp the jump out almost instantly. A ceiling is
// idempotent, so re-applying it every frame changes nothing and the same hold
// produces the same height on any machine.
//
// At -9.5 against JUMP_VELOCITY's -13.5, a bare tap still clears the tallest
// cactus with a little room, so tapping is never a death sentence - it just
// costs the airtime that a full jump buys for whatever comes next.
var JUMP_RELEASE_VELOCITY = -9.5;

//tracked so a jump only fires on a fresh key press - see the comment where
//this is used, in the PLAY branch of draw().
var jumpKeyWasDown = false;

// p5.play's keyDown() only reads true starting the SECOND frame a key has
// been held - the frame it's first pressed is internally tagged
// KEY_WENT_DOWN, not KEY_IS_DOWN yet, and keyDown() checks for the latter
// specifically. draw() runs far faster than one frame per real 60fps tick
// here, so an ordinary fast tap can start and end within that single first
// frame - going was-up -> went-down -> went-up without keyDown() ever once
// reading true, missing the press entirely. keyWentDown() catches exactly
// that first frame, so OR the two together for any key that matters as
// soon as it's pressed, not just once it's been held a moment.
function keyHeld(key) {
  return keyDown(key) || keyWentDown(key);
}

// Jump: space, up arrow, W, or a tap on the top half of the screen.
// Duck/fast-fall: down arrow, S, or a touch held on the bottom half (ducks
// like Chrome's dino while grounded, fast-falls while airborne) - keyboard
// players get both for free from separate keys, so touch needs its own way
// to reach duck instead of only ever being able to jump.
function jumpPressed() {
  return keyHeld("space") || keyHeld("up") || keyHeld("w") || touchIsDown;
}

function duckPressed() {
  return keyHeld("down") || keyHeld("s") || touchDuckIsDown;
}

// There is no separate duck sprite in this project's assets, so the crouch
// is faked by squashing the running sprite shorter and wider, like Chrome's
// dino. p5.play normally recomputes a sprite's width/height from its raw
// animation frame every time the frame changes, which would undo our squash
// a few frames later - _fixedSpriteAnimationFrameSizes turns that off so a
// manually-set width/height sticks. It's engaged lazily on the first duck
// (not in setup()) so trex.width/height are already correct real values,
// not the createSprite() placeholder box, when they get frozen.
var CROUCH_WIDTH_FACTOR = 1.35;
var CROUCH_HEIGHT_FACTOR = 0.55;
var isCrouching = false;
var trexStandingWidth = null;
var trexStandingHeight = null;

function setCrouching(crouch) {
  if (crouch === isCrouching) {
    return;
  }
  isCrouching = crouch;

  if (trexStandingWidth === null) {
    trexStandingWidth = trex.width;
    trexStandingHeight = trex.height;
    p5.instance._fixedSpriteAnimationFrameSizes = true;

    // setCollider('rectangle') with no size args re-derives the hitbox from
    // the RAW animation frame every frame (ignoring our width/height entirely),
    // which fought our crouch box and made collisions unreliable. Passing
    // explicit dimensions freezes a custom size instead, BUT the collider's
    // transform re-applies trex.scale * trex._horizontalStretch (resp.
    // _verticalStretch) every frame once _fixedSpriteAnimationFrameSizes is
    // on - that stretch factor is exactly what turns the standing size into
    // the crouched one, so setting the collider once here in RAW pre-scale
    // pixels (standing size / scale) makes it self-adjust correctly to both
    // states automatically, with no need to touch it again on every toggle.
    trex.setCollider('rectangle', 0, 0, trexStandingWidth / trex.scale, trexStandingHeight / trex.scale);
  }

  var previousHeight = trex.height;
  if (crouch) {
    trex.width = trexStandingWidth * CROUCH_WIDTH_FACTOR;
    trex.height = trexStandingHeight * CROUCH_HEIGHT_FACTOR;
  } else {
    trex.width = trexStandingWidth;
    trex.height = trexStandingHeight;
  }
  //re-anchor so the feet stay on the ground instead of the sprite shrinking/growing from its center
  trex.y += (previousHeight - trex.height) / 2;
}

function currentSpeed() {
  return Math.min(BASE_SPEED + SPEED_PER_100_SCORE * Math.floor(score) / 100, MAX_SPEED);
}

// ---------------------------------------------------------------------------
// Silhouette collision
//
// p5.play collides sprites as plain rectangles covering the whole image. Every
// sprite here fills its image edge to edge, so there is no transparent margin
// to trim - but the ARTWORK is not rectangular. A cactus is a trunk with arms,
// so the corners above its arms are empty, the multi-cactus images have empty
// gaps between plants, and the trex has empty space under its head and above
// its tail. Those empty corners are what met each other, killing the player
// when nothing visibly touched.
//
// Instead of one box, each image is reduced to a per-column solid span (the
// topmost and bottommost non-transparent pixel in every column) and collision
// compares those spans. That follows the real shape closely: passing over a
// cactus arm, or through the gap between two plants, no longer registers.
// ---------------------------------------------------------------------------

//how many on-screen pixels the trex silhouette is shrunk by, so grazes forgive
var HITBOX_FORGIVENESS = 2;

var profileCache = {};
var nextProfileId = 1;

function imageProfile(img) {
  if (img.__profileId === undefined) {
    img.__profileId = nextProfileId++;
  }
  var cached = profileCache[img.__profileId];
  if (cached) {
    return cached;
  }

  var w = img.width;
  var h = img.height;
  img.loadPixels();
  var px = img.pixels;
  //p5 may store pixels at a higher density than the image's logical size
  var density = Math.max(1, Math.round(Math.sqrt(px.length / (4 * w * h))));
  var rowWidth = w * density;

  var top = new Array(w);
  var bottom = new Array(w);
  for (var x = 0; x < w; x++) {
    top[x] = -1;
    bottom[x] = -1;
    for (var y = 0; y < h; y++) {
      var alpha = px[4 * (y * density * rowWidth + x * density) + 3];
      if (alpha > 0) {
        if (top[x] === -1) {
          top[x] = y;
        }
        bottom[x] = y;
      }
    }
  }

  cached = { w: w, h: h, top: top, bottom: bottom };
  profileCache[img.__profileId] = cached;
  return cached;
}

// Where the sprite's image sits in world space, and how big one image pixel is
// on screen.
//
// Deliberately NOT using sprite.width/height: spawnObstacles() calls addImage()
// before setting scale, and p5.play only recomputes those cached dimensions
// when an animation frame changes - which never happens for a single-image
// sprite. So an obstacle reports its raw 50x100 size while being drawn at
// 25x50. The sprite's own scale accessors are what p5.play uses to draw and to
// size colliders, and they fold in the crouch stretch too, so a squashed trex
// is handled automatically.
function spriteSilhouette(sprite) {
  if (!sprite.animation) {
    return null;
  }
  var img = sprite.animation.getFrameImage();
  if (!img || !img.width) {
    return null;
  }
  var profile = imageProfile(img);
  var scaleX = Math.abs(sprite._getScaleX());
  var scaleY = Math.abs(sprite._getScaleY());
  return {
    profile: profile,
    left: sprite.x - (profile.w * scaleX) / 2,
    top: sprite.y - (profile.h * scaleY) / 2,
    pixelWidth: scaleX,
    pixelHeight: scaleY
  };
}

function silhouettesTouch(a, b, shrinkB) {
  var aRight = a.left + a.profile.w * a.pixelWidth;
  var bRight = b.left + b.profile.w * b.pixelWidth;
  if (aRight <= b.left || bRight <= a.left) {
    return false;
  }

  for (var ax = 0; ax < a.profile.w; ax++) {
    if (a.profile.top[ax] === -1) {
      continue;
    }
    var columnLeft = a.left + ax * a.pixelWidth;
    var columnRight = columnLeft + a.pixelWidth;
    if (columnRight <= b.left || columnLeft >= bRight) {
      continue;
    }

    var aTop = a.top + a.profile.top[ax] * a.pixelHeight;
    var aBottom = a.top + (a.profile.bottom[ax] + 1) * a.pixelHeight;

    var bxStart = Math.floor((columnLeft - b.left) / b.pixelWidth);
    var bxEnd = Math.ceil((columnRight - b.left) / b.pixelWidth);
    if (bxStart < 0) {
      bxStart = 0;
    }
    if (bxEnd > b.profile.w) {
      bxEnd = b.profile.w;
    }

    for (var bx = bxStart; bx < bxEnd; bx++) {
      if (b.profile.top[bx] === -1) {
        continue;
      }
      var bTop = b.top + b.profile.top[bx] * b.pixelHeight + shrinkB;
      var bBottom = b.top + (b.profile.bottom[bx] + 1) * b.pixelHeight - shrinkB;
      if (bTop < bBottom && aTop < bBottom && bTop < aBottom) {
        return true;
      }
    }
  }
  return false;
}

function trexHitsAnyObstacle() {
  var trexShape = spriteSilhouette(trex);
  if (!trexShape) {
    return false;
  }
  //forgive a couple of pixels horizontally as well as vertically
  trexShape.left += HITBOX_FORGIVENESS;
  trexShape.pixelWidth -= (2 * HITBOX_FORGIVENESS) / trexShape.profile.w;

  for (var i = 0; i < obstaclesGroup.length; i++) {
    var obstacleShape = spriteSilhouette(obstaclesGroup[i]);
    if (obstacleShape && silhouettesTouch(obstacleShape, trexShape, HITBOX_FORGIVENESS)) {
      return true;
    }
  }
  return false;
}

// Where an obstacle's bottom edge should land, in world y - matches where
// the trex's own feet rest (bottom = trex.y + trex.height/2 ≈ 185).
var GROUND_SURFACE_Y = 185;

// Obstacles and clouds are spaced by distance travelled, not by a timer, so
// the gaps between them stay the same no matter how slow or fast the game runs.
// The gap is re-rolled after every spawn instead of being a fixed number,
// which is what made the rhythm feel metronomic.
//
// It is measured in "jump lengths" rather than raw pixels: a jump covers
// airtime * speed pixels of ground, so as the game speeds up a fixed pixel
// gap would quietly become unclearable (at MAX_SPEED a single jump covers
// ~405px, more than the old fixed 350px gap). Anchoring to jump length keeps
// the spacing honest at every speed.
// ---------------------------------------------------------------------------
// Deterministic obstacle stream
//
// In a multiplayer race both players must run the IDENTICAL course, and the
// server only ever sends a seed (see the "start" message in server/server.js) -
// the course itself is generated locally on each client and never transmitted.
// That only works if obstacle generation is a pure function of that seed,
// which rules out p5's global random(): it is shared with the clouds and with
// the death-shake, and the shake is rolled once per FRAME. Two machines at
// 60Hz and 144Hz would consume a wildly different number of values, so the
// obstacle draws would land at different points in the sequence and the two
// courses would diverge within seconds.
//
// So obstacles get their own private stream, consumed by nothing else. The Nth
// obstacle then draws the Nth set of values on both machines no matter what
// the framerate, what the clouds did, or how long anyone spent on the menu.
//
// Two rules keep that guarantee, and both matter more than they look:
//
//   1. Every spawn draws exactly THREE values, always, even when a gate means
//      one of them goes unused. A draw that only happens sometimes would shift
//      every later draw on one client and desync the course permanently.
//   2. Those gates are keyed to the obstacle INDEX, never to the score. Score
//      accumulates in floating point at the local framerate, so it crosses any
//      threshold at fractionally different moments on each machine - and one
//      client taking a branch the other did not is exactly the desync that
//      rule 1 exists to prevent.
//
// Single player runs the same path on a randomly chosen seed, so there is one
// code path to reason about rather than two.
// ---------------------------------------------------------------------------

//mulberry32 - small, fast, and identical across browsers and devices because
//every step is forced back into 32-bit integer space, leaving no float
//rounding for two engines to disagree about
function makeRandomStream(seed) {
  var state = seed >>> 0;
  return function () {
    state = (state + 0x6d2b79f5) >>> 0;
    var t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

var obstacleStream = makeRandomStream(1);
//how many obstacles this run has spawned - drives the unlock gates, see rule 2
var obstaclesSpawned = 0;

function seedObstacleStream(seed) {
  obstacleStream = makeRandomStream(seed);
  obstaclesSpawned = 0;
}

//same (min, max) shape as p5's random(), so the call sites read the same way
function obstacleRandom(min, max) {
  var unit = obstacleStream();
  if (min === undefined) {
    return unit;
  }
  if (max === undefined) {
    max = min;
    min = 0;
  }
  return min + unit * (max - min);
}

// A multiplayer race must use the seed the server handed to both players; a
// single-player run just wants a different course each time.
function nextRunSeed() {
  if (mpSeed !== null) {
    return mpSeed;
  }
  return Math.floor(Math.random() * 2147483647);
}

var OBSTACLE_GAP_MIN_JUMPS = 1.35;
var OBSTACLE_GAP_MAX_JUMPS = 2.8;
var CLOUD_GAP_MIN_PX = 120;
var CLOUD_GAP_MAX_PX = 400;
var distanceTravelled = 0;
var lastObstacleSpawnDistance = 0;
var lastCloudSpawnDistance = 0;
var nextObstacleGap = 0;
var nextCloudGap = 0;
//width of the obstacle just spawned, so wide cactus clusters earn extra room
var lastObstacleWidth = 0;

//takes an already-drawn 0-1 value rather than drawing its own, so the caller
//controls exactly where in the stream the draw happens - see rule 1 above
function rollObstacleGap(unitRoll) {
  var airtimeFrames = 2 * Math.abs(JUMP_VELOCITY) / GRAVITY;
  var jumpDistance = airtimeFrames * currentSpeed();
  var gapInJumps = OBSTACLE_GAP_MIN_JUMPS +
                   unitRoll * (OBSTACLE_GAP_MAX_JUMPS - OBSTACLE_GAP_MIN_JUMPS);
  return lastObstacleWidth + jumpDistance * gapInJumps;
}

function rollCloudGap() {
  return random(CLOUD_GAP_MIN_PX, CLOUD_GAP_MAX_PX);
}

// localStorage access throws (not just "fails") in some contexts - private
// browsing, blocked third-party cookies, sandboxed iframes - and this runs
// at the top level outside setup(), so an uncaught throw here would abort
// the whole script before the canvas ever appears. Fall back to an
// in-memory high score (just doesn't persist across reloads) instead.
function readHighScore() {
  try {
    return Number(localStorage["HighestScore"]) || 0;
  } catch (e) {
    return 0;
  }
}

function saveHighScore(value) {
  try {
    localStorage["HighestScore"] = value;
  } catch (e) {
    //storage unavailable - high score just won't survive a reload
  }
}

//kept as a live number so it can update mid-run, not just read from
//localStorage (a string) when the game ends
var highScore = readHighScore();

// What's actually in storage right now. The live highScore is beaten - and
// so becomes worth saving - on a single frame somewhere mid-run, but writing
// it there would mean a localStorage write on every frame of every run past
// the old best, at up to 1000 frames a second. Tracking what has already
// been written lets persistHighScore() be called freely from anywhere: it is
// a no-op unless there is genuinely something new to store.
var savedHighScore = highScore;

// The record as it stood when this run began, which is what "have I beaten my
// best?" actually means. It cannot be read off savedHighScore: persisting is
// wired to visibilitychange and pagehide, so tabbing away mid-run writes the
// new best to storage and savedHighScore catches up with it - and the badge
// saying you had beaten it would vanish on coming back.
var runStartHighScore = highScore;

function persistHighScore() {
  if (highScore <= savedHighScore) {
    return;
  }
  saveHighScore(highScore);
  savedHighScore = highScore;
}

// Beating your best and then simply closing the tab used to lose it. The only
// save was in resetGame(), so the score survived only if the player pressed
// restart or went back to the menu afterwards - quitting from the game-over
// screen, or from the result screen after a race, threw the record away.
//
// Both events are needed, and neither is beforeunload:
//   visibilitychange - fires when a phone is locked or the app is switched
//     away from, which on mobile is very often the last event a page ever
//     gets; the tab may be discarded without ever coming back.
//   pagehide - covers the desktop close/navigate case, and unlike unload it
//     still fires for a page restored from the back-forward cache.
// Both can fire for one departure, which costs nothing: the second call finds
// nothing new to write.
if (typeof document !== "undefined" && document.addEventListener) {
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "hidden") {
      persistHighScore();
    }
  });
}
if (typeof window !== "undefined" && window.addEventListener) {
  window.addEventListener("pagehide", persistHighScore);
}

// Cached: this is read on every pointer move as well as on every tap, resize
// and touch, so re-querying the DOM each time was needless work.
var gameCanvasElt = null;

// Re-queried whenever the cached node has left the document. p5 replaces the
// canvas outright in some resize/renderer paths, and a handler still holding
// the detached one measures a box that is no longer on screen - every
// getBoundingClientRect() on a detached element reads 0, which silently turns
// every click into a miss.
function canvasElement() {
  if (!gameCanvasElt || (gameCanvasElt.isConnected === false)) {
    gameCanvasElt = document.querySelector("canvas");
  }
  return gameCanvasElt;
}

function padScore(n) {
  var s = String(Math.floor(n));
  while (s.length < 5) {
    s = "0" + s;
  }
  return s;
}

// The lower half of the GAMEPLAY STRIP counts as duck/fast-fall; everything
// above it - including all the sky padding - is a jump.
//
// Splitting on the whole screen instead, as this used to, is only equivalent
// on a 3:1 display. Everywhere else fillScreen() makes the canvas as tall as
// the screen's shape demands and parks the 600x200 strip low inside it (60% of
// the spare height goes above as sky). On a portrait phone that is dramatic:
// a 400x800 screen gives a 600x1200 canvas with the strip at y 600-800, so the
// screen's midpoint at y=600 lands on the strip's very top edge - putting the
// ENTIRE playfield, dino included, inside the duck zone. Tapping next to the
// dino to jump ducked instead, and only a tap up in the empty sky jumped.
function isDuckTouchPoint(pointerEvent) {
  var point = canvasPointerToGame(pointerEvent);
  return point !== null && point.y > GAME_HEIGHT / 2;
}

// Both flags are recomputed from every finger currently on the glass, rather
// than each event toggling one of them. Two separate bugs came from doing it
// the other way, and both hurt most in exactly the place multi-touch matters -
// the crow pair, which demands a duck immediately followed by a jump:
//
//   - A new finger was judged by e.touches[0], which is the first ACTIVE touch
//     and not the new one. So with a finger already ducking, a second finger
//     tapping up top was read at the DUCKING finger's position and registered
//     as another duck. The jump never happened.
//   - Lifting either finger cleared both flags, so releasing the jump finger
//     silently cancelled a duck that was still being held.
//
// Reading the whole list makes both correct by construction, and handles
// touchcancel (a system gesture or an incoming call) for free, since that
// event's touches list is already missing the interrupted finger.
// A finger on the mute or pause button is doing that and nothing else. Left
// out, the tap that silenced the game would also jump the trex into the next
// cactus - and on the game-over screen, where every tap retries, the tap that
// muted it would have restarted the run underneath.
function isHudControlTouch(pointerEvent) {
  var point = canvasPointerToGame(pointerEvent);
  if (point === null) {
    return false;
  }
  var controls = hudControlsOnScreen();
  for (var i = 0; i < controls.length; i++) {
    if (isOverButton(controls[i], point.x, point.y)) {
      return true;
    }
  }
  return false;
}

function updateTouchZones(e) {
  var jumping = false;
  var ducking = false;
  for (var i = 0; i < e.touches.length; i++) {
    if (isHudControlTouch(e.touches[i])) {
      continue;
    }
    // The zone split only means something during gameplay - on the game-over
    // and menu screens every tap should count as a press, rather than one on
    // the lower half being swallowed as a duck and silently doing nothing.
    if (gameState === PLAY && isDuckTouchPoint(e.touches[i])) {
      ducking = true;
    } else {
      jumping = true;
    }
  }
  touchIsDown = jumping;
  touchDuckIsDown = ducking;
}

// A MouseEvent arrives here too: p5 routes mousePressed/mouseReleased to
// touchStarted/touchEnded when those aren't defined, and a mouse event carries
// no touches list. It is one pointer that can only ever mean "press".
function touchStarted(e) {
  if (!e || !e.touches) {
    touchIsDown = true;
    return;
  }
  updateTouchZones(e);
}

function touchEnded(e) {
  if (!e || !e.touches) {
    touchIsDown = false;
    touchDuckIsDown = false;
    return;
  }
  updateTouchZones(e);
}

// p5 wires touchstart/touchend to touchStarted()/touchEnded() above, but has
// no hook for touchcancel - fired when a system gesture, incoming call, or a
// second finger interrupts an in-progress touch. Without this, touchIsDown
// would stay stuck true forever after a cancelled touch, and since
// jumpPressed() (and restartKeyDown() on the game-over screen) read it, the
// trex would keep jumping/restarting every single frame until the page is
// reloaded.
document.addEventListener("touchcancel", touchEnded);

// p5.play calls p5's _updateTouchCoords() with no argument, but p5 0.8.0
// requires the event object and reads e.touches from it. The resulting
// TypeError was thrown inside every mousedown and touchstart handler,
// aborting them before the sketch's own handlers ran - which is why clicks
// and taps did nothing. Make the argument optional.
(function patchTouchCoords() {
  var original = p5.prototype._updateTouchCoords;
  p5.prototype._updateTouchCoords = function(e) {
    if (!e || !e.touches) {
      return;
    }
    return original.call(this, e);
  };
})();

// ---------------------------------------------------------------------------
// Naming the right controls
//
// Several screens tell the player what to press - P to resume, R for a
// rematch, 1 or 2 on the menu. On a phone there is nothing to press, so those
// prompts named keys the player did not have, and on the pause screen the only
// instruction given was one a phone player could not follow.
//
// The wording follows the input the player last actually used rather than a
// guess about the device. A touchscreen laptop is both, and a phone with a
// Bluetooth keyboard is a keyboard player - what they last touched is the one
// thing that is never wrong about what they have in hand. Before any input at
// all, a coarse pointer is the best available guess.
// ---------------------------------------------------------------------------
var playerIsOnTouch = typeof window.matchMedia === "function" &&
                      window.matchMedia("(pointer: coarse)").matches;

document.addEventListener("pointerdown", function (e) {
  if (e.pointerType === "touch") {
    playerIsOnTouch = true;
  } else if (e.pointerType === "mouse") {
    playerIsOnTouch = false;
  }
});
document.addEventListener("keydown", function (e) {
  // A phone's on-screen keyboard fires keydown into the room code field, and
  // typing a code there does not make anyone a keyboard player.
  if (e.target && (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA")) {
    return;
  }
  playerIsOnTouch = false;
});

// Set by the canvas pointer handler below and consumed in draw().
var restartRequested = false;

// Restarting after Game Over: any of the jump keys (Space/Up/W/tap), or
// Enter. Reusing jumpPressed() means restart keys match jump keys exactly,
// including future changes to those, without listing them twice.
var restartKeyWasDown = false;
function restartKeyDown() {
  return keyHeld("enter") || jumpPressed();
}

// p5.play maps pointer positions with canvas.offsetWidth (the CSS size)
// instead of canvas.width (the drawing buffer), so mouseX/mouseY come back
// in screen pixels once the canvas is scaled to fill the window - which
// broke mousePressedOver(). Do the conversion properly ourselves.
function canvasPointerToGame(evt) {
  var canvasElt = canvasElement();
  if (!canvasElt) {
    return null;
  }
  var rect = canvasElt.getBoundingClientRect();
  if (!rect.width || !rect.height) {
    return null;
  }
  //width/height are the (possibly taller than 200) canvas; the strip offset
  //is where the gameplay strip sits inside it - see fillScreen()
  var point = {
    x: (evt.clientX - rect.left) * (width / rect.width),
    y: (evt.clientY - rect.top) * (height / rect.height) - viewOffsetY
  };
  //a detached or zero-sized canvas, or a resize landing mid-event, can make
  //these NaN - and every comparison against NaN is false, so a bad point
  //silently becomes "nothing is clickable" rather than an obvious failure
  if (!isFinite(point.x) || !isFinite(point.y)) {
    return null;
  }
  return point;
}

function isOverRestart(x, y) {
  if (!restart || !restart.visible) {
    return false;
  }
  //a few px of padding makes the button easier to hit, especially on touch
  var halfWidth = (restart.width * restart.scale) / 2 + 6;
  var halfHeight = (restart.height * restart.scale) / 2 + 6;
  return Math.abs(x - restart.x) <= halfWidth &&
         Math.abs(y - restart.y) <= halfHeight;
}

// ---------------------------------------------------------------------------
// Multiplayer networking
//
// A thin wrapper around one WebSocket connection to the room-relay server
// (see server/server.js). This server is NOT authoritative - it only hands
// out room codes and relays messages between the two players in a room. Both
// clients run the actual game themselves, in lockstep, because they're both
// seeded with the same random seed from the "start" message: obstacle
// spawning is deterministic from that seed, so there is nothing to
// synchronize there. The only live network traffic is each player's own
// trex height/crouch/alive state, so the other player can be rendered.
// ---------------------------------------------------------------------------

// Where to find the relay. The server hosts these game files itself (see the
// static-hosting block in server/server.js), so in every normal case the
// socket lives at the exact address this page was loaded from - which means
// no URL needs hardcoding or editing per environment. Running on localhost,
// on a phone over wifi, and deployed to Render all resolve correctly from
// location alone.
//
// Two escape hatches on top of that:
//   - ?server=wss://host  overrides it outright, for pointing a local page at
//     a deployed relay (or vice versa) without touching this file.
//   - Opening index.html straight off the disk as a file:// URL has no host to
//     derive anything from, so that case falls back to a local server.
var MULTIPLAYER_SERVER_FALLBACK = "ws://localhost:8080";

function resolveServerUrl() {
  var override = /[?&]server=([^&]+)/.exec(window.location.search);
  if (override) {
    return decodeURIComponent(override[1]);
  }
  if (window.location.protocol === "file:" || !window.location.host) {
    return MULTIPLAYER_SERVER_FALLBACK;
  }
  //wss:// for an https page - a secure page is not allowed to open a plain
  //ws:// socket, and the browser blocks it outright rather than warning
  var scheme = window.location.protocol === "https:" ? "wss:" : "ws:";
  return scheme + "//" + window.location.host;
}

var mpSocket = null;
var mpRoomCode = null;
// Joining someone else's room rather than hosting one. Both players sit on the
// same waiting screen while their socket connects, but only the host is
// waiting for an opponent or has a room worth sharing - see
// drawMultiplayerWaitingScreen().
var mpJoining = false;
var mpSeed = null;
var mpConnectionMessage = null;

// Race state. mpIsRacing is what tells the shared gameplay code it is running
// a race rather than a solo run - it gates restarting (which would desync a
// race), and routes death to the result screen instead of Game Over.
var mpIsRacing = false;
//local clock time the race begins - see the countdownMs comment in server.js
var mpRaceStartMillis = 0;
var mpSelfScore = 0;
var mpSelfFinished = false;
var mpOpponentFinished = false;
//null means the opponent quit rather than finishing a run
var mpOpponentScore = null;
var mpOpponentLeft = false;
//the socket died mid-race, so the result can't be trusted either way
var mpConnectionLost = false;

//rematch needs both players to ask, so each side is tracked separately
var mpRematchRequested = false;
var mpOpponentWantsRematch = false;

// Whether anyone is still on the other end. Deliberately NOT the same thing as
// mpOpponentLeft, which answers a different question - did they forfeit the
// race - and is specifically false when they post a score and then close the
// tab, so that their result stands. Using that one flag for both meant the
// most ordinary ending of all (they crash, they leave) still offered a
// rematch, and the server had already deleted the room when their socket
// closed, so asking for one waited on a reply that could never come.
var mpOpponentPresent = true;

// Live opponent position, as last reported. null means nothing has arrived
// yet, so there is nothing to draw.
var mpOpponentY = null;
var mpOpponentCrouching = false;
var mpOpponentAlive = true;
//smoothed toward mpOpponentY every frame - see drawOpponentGhost()
var mpGhostY = null;

// The opponent's score as of their last update. Kept separate from
// mpOpponentScore, which is the authoritative final the result screen is
// decided on - this one is a live readout that is expected to lag slightly.
var mpOpponentLiveScore = null;

//how long the "they are out of it" banner stays up, in a race you are still
//running - whether they crashed or quit
var MP_CRASH_BANNER_MS = 2500;
var mpOpponentGoneBannerUntil = 0;

function mpResetRaceState() {
  mpIsRacing = false;
  mpSelfFinished = false;
  mpOpponentFinished = false;
  mpOpponentScore = null;
  mpOpponentLeft = false;
  mpConnectionLost = false;
  mpSelfScore = 0;
  mpOpponentY = null;
  mpOpponentCrouching = false;
  mpOpponentAlive = true;
  mpGhostY = null;
  mpLastStateSentMillis = 0;
  mpOpponentLiveScore = null;
  mpOpponentGoneBannerUntil = 0;
  mpRematchRequested = false;
  mpOpponentWantsRematch = false;
  mpOpponentPresent = true;
  //cleared here too, so a tap that landed just as the next race began can't
  //sit around and auto-accept the rematch after it
  multiplayerRematchRequested = false;
}

function mpDisconnect() {
  if (mpSocket) {
    //no-op handlers first so the close below doesn't bounce us back into
    //the menu a second time via onclose's own error-handling path
    mpSocket.onopen = null;
    mpSocket.onmessage = null;
    mpSocket.onerror = null;
    mpSocket.onclose = null;
    if (mpSocket.readyState === WebSocket.OPEN) {
      mpSocket.send(JSON.stringify({ type: "leave" }));
    }
    mpSocket.close();
  }
  mpSocket = null;
  mpRoomCode = null;
  mpJoining = false;
  //must be cleared, or the next single-player run would keep replaying the
  //race's course - nextRunSeed() prefers mpSeed whenever it is set
  mpSeed = null;
  mpSocketOpen = false;
  mpResetRaceState();
}

function mpHandleMessage(msg) {
  if (msg.type === "created") {
    mpRoomCode = msg.room;
  } else if (msg.type === "start") {
    mpSeed = msg.seed;
    mpResetRaceState();
    //counted from right now on this device's own clock, which is the whole
    //reason the server sends a duration instead of a timestamp
    mpRaceStartMillis = millis() + msg.countdownMs;
    countdownSecondBeeped = null;
    // Clear the board before the countdown rather than when it ends, so the
    // player counts down over a fresh starting line - otherwise a rematch
    // would tick 3-2-1 over the previous run's crashed trex and dead cacti.
    resetGame(MULTIPLAYER_COUNTDOWN);
  } else if (msg.type === "opponent_state") {
    mpOpponentY = msg.y;
    mpOpponentCrouching = !!msg.crouching;
    mpOpponentAlive = !msg.dead;
    mpOpponentLiveScore = msg.score;
  } else if (msg.type === "opponent_wants_rematch") {
    mpOpponentWantsRematch = true;
  } else if (msg.type === "opponent_finished") {
    mpOpponentFinished = true;
    mpOpponentScore = msg.score;
    mpOpponentLiveScore = msg.score;
    mpOpponentAlive = false;
    //only worth announcing to a player still running - it turns their race
    //from "stay ahead" into a concrete score to beat
    if (mpIsRacing && !mpSelfFinished) {
      mpOpponentGoneBannerUntil = millis() + MP_CRASH_BANNER_MS;
    }
  } else if (msg.type === "error") {
    mpConnectionMessage = msg.message;
    mpDisconnect();
    gameState = MULTIPLAYER_MENU;
  } else if (msg.type === "opponent_left") {
    //however it ended for the race, the seat beside you is empty now
    mpOpponentPresent = false;
    if (mpIsRacing && mpOpponentFinished) {
      // They already reported a final score and have now closed the tab -
      // which is the normal way to leave once a race is over. Their score
      // stands. Treating this as a forfeit would wipe a legitimate result and
      // hand an undeserved win to whoever happened to still have the page up.
      mpOpponentLeft = false;
    } else if (mpIsRacing) {
      // Gone mid-run without finishing: that is a forfeit. The player is still
      // owed a result screen for the run they are doing, so deliberately don't
      // tear the session down here.
      mpOpponentLeft = true;
      mpOpponentFinished = true;
      mpOpponentScore = null;
      // Their last reported state is now a fiction and must not keep being
      // drawn as a live rival: the ghost would jog on the spot with its legs
      // moving, beside a scoreboard still counting a gap to a player who has
      // closed the tab. Announce it and take them off the track instead.
      mpOpponentAlive = false;
      mpOpponentGoneBannerUntil = millis() + MP_CRASH_BANNER_MS;
    } else {
      mpConnectionMessage = "Opponent disconnected.";
      mpDisconnect();
      gameState = MULTIPLAYER_MENU;
    }
  }
}

// ---------------------------------------------------------------------------
// Live position sync
//
// Deliberately rate-limited rather than sent every frame: draw() runs at the
// display's refresh rate, so a 240Hz machine would otherwise fire 240 messages
// a second at a free-tier relay for no visible benefit. 20/sec is far below
// what the eye can distinguish once the ghost is interpolated between updates,
// which drawOpponentGhost() does.
// ---------------------------------------------------------------------------
var MP_STATE_SEND_INTERVAL_MS = 50;
var mpLastStateSentMillis = 0;

function mpSendState() {
  if (!mpSocket || mpSocket.readyState !== WebSocket.OPEN) {
    return;
  }
  var now = millis();
  if (now - mpLastStateSentMillis < MP_STATE_SEND_INTERVAL_MS) {
    return;
  }
  mpLastStateSentMillis = now;
  mpSocket.send(JSON.stringify({
    type: "state",
    //rounded because a pixel of sub-pixel precision is invisible but makes
    //every message meaningfully longer
    y: Math.round(trex.y),
    crouching: isCrouching,
    dead: false,
    score: Math.floor(score)
  }));
}

// Called the moment this player crashes. The opponent may still be running,
// so this does not decide a winner - it just reports the final score and
// moves to the result screen, which waits for the other side.
function mpFinish(finalScore) {
  mpSelfFinished = true;
  mpSelfScore = finalScore;
  if (mpSocket && mpSocket.readyState === WebSocket.OPEN) {
    mpSocket.send(JSON.stringify({ type: "finished", score: finalScore }));
  }
  gameState = MULTIPLAYER_RESULT;
}

// ---------------------------------------------------------------------------
// Opponent ghost
//
// Drawn at the SAME x as the local trex, not off to one side. Both players run
// an identical course at an identical speed, so their world positions match -
// which means overlaying the ghost is what makes the race readable: you can
// see directly whether they cleared the cactus you're approaching, and whether
// they jumped earlier or later than you. Sliding it sideways would throw that
// relationship away and turn it into decoration.
//
// Tinted blue and translucent so there is never any doubt which dino is yours.
// ---------------------------------------------------------------------------
//populated in preload()
var ghostRunFrames = null;
var ghostCollidedImage = null;

var GHOST_TINT = [90, 150, 255];
var GHOST_ALPHA = 125;
//ms per running-animation frame; wall-clock rather than draw-frame based, so
//the ghost's legs move at the same rate on a 60Hz and a 240Hz display
var GHOST_FRAME_MS = 110;
// How fast the ghost catches up to the last reported position. State arrives
// at 20/sec but draw() runs several times faster, so without this the ghost
// would visibly step between positions instead of moving.
var GHOST_SMOOTHING_PER_MS = 0.02;

function mpShouldDrawGhost() {
  if (mpOpponentY === null) {
    return false;
  }
  //a forfeited opponent has no position to show - see the forfeit branch of
  //mpHandleMessage()
  if (mpOpponentLeft) {
    return false;
  }
  //while racing, and while dead but still watching them finish
  return mpIsRacing || (gameState === MULTIPLAYER_RESULT && !mpOpponentFinished);
}

function drawOpponentGhost(dt) {
  if (!mpShouldDrawGhost()) {
    return;
  }

  if (mpGhostY === null) {
    mpGhostY = mpOpponentY;
  } else {
    //exponential approach, framed in real time so it converges at the same
    //rate regardless of how often draw() happens to run
    var catchUp = 1 - Math.pow(1 - GHOST_SMOOTHING_PER_MS, Math.max(0, dt));
    mpGhostY += (mpOpponentY - mpGhostY) * catchUp;
  }

  var image_ = mpOpponentAlive
    ? ghostRunFrames[Math.floor(millis() / GHOST_FRAME_MS) % ghostRunFrames.length]
    : ghostCollidedImage;
  if (!image_ || !image_.width) {
    return;
  }

  var w = image_.width * trex.scale;
  var h = image_.height * trex.scale;
  if (mpOpponentCrouching) {
    w *= CROUCH_WIDTH_FACTOR;
    h *= CROUCH_HEIGHT_FACTOR;
  }

  //scaled by the ghost's own transparency, so its outline never reads as more
  //solid than the ghost it belongs to
  drawNightOutline(image_, trex.x, mpGhostY, w, h, nightAmount * (GHOST_ALPHA / 255));

  //the blue is baked into the frame once rather than recomputed every time it
  //is drawn - GHOST_TINT never changes, so neither does the result
  beginImageAlpha(GHOST_ALPHA / 255);
  image(tintedImage(image_, GHOST_TINT), trex.x, mpGhostY, w, h);
  endImageAlpha();
}

// ---------------------------------------------------------------------------
// Race HUD
//
// Replaces the solo high-score line for the duration of a race. The high score
// is not what anyone is playing for here - the number that matters is the
// opponent's, so it takes that slot instead.
// ---------------------------------------------------------------------------
function inRaceView() {
  return mpIsRacing ||
         gameState === MULTIPLAYER_COUNTDOWN ||
         gameState === MULTIPLAYER_RESULT;
}

// The corner scoreboard is for running. The countdown and result screens put
// their own panel across the middle of the strip, and on a wide screen - every
// phone held sideways - there is so little sky above the strip that the
// scoreboard's plate landed on top of that panel. It had nothing to add there
// anyway: during the countdown both scores are zero, and a decided result
// panel carries both finals and the margin gauge. The one number it did carry,
// the live score of an opponent still running after you crashed, is on the
// panel now too.
function raceScoreboardIsShown() {
  return mpIsRacing && gameState === PLAY;
}

// The lead, as a bar rather than only as a number. A signed integer tells you
// the gap but not how big a gap that is - "+40" means nothing until you have
// played enough races to know. A needle sitting a little right of centre says
// "just ahead" at a glance, without being read.
//
// The bar saturates at RACE_GAUGE_FULL_LEAD because the interesting range is
// the close one: beyond a couple of hundred points the race is decided, and
// scaling to the largest gap seen would flatten every close finish into a
// twitch around the middle.
var RACE_GAUGE_FULL_LEAD = 150;

function drawLeadGauge(centerX, centerY, w, h, lead) {
  var fraction = constrain(lead / RACE_GAUGE_FULL_LEAD, -1, 1);
  push();
  rectMode(CENTER);
  noStroke();
  fill(INK[0], INK[1], INK[2]);
  rect(centerX, centerY, w + 4, h + 4);
  fill(CODE_TILE_FACE[0], CODE_TILE_FACE[1], CODE_TILE_FACE[2]);
  rect(centerX, centerY, w, h);

  var reach = Math.abs(fraction) * (w / 2);
  if (reach > 0) {
    var rgb = fraction > 0 ? PANEL_GOOD : PANEL_BAD;
    fill(rgb[0], rgb[1], rgb[2]);
    rect(centerX + (fraction > 0 ? reach / 2 : -reach / 2), centerY, reach, h);
  }

  //the centre mark, so a small lead reads as a small lead and not as "ahead"
  fill(PANEL_TEXT[0], PANEL_TEXT[1], PANEL_TEXT[2], 150);
  rect(centerX, centerY, 2, h + 2);
  pop();
}

var RACE_HUD_LABEL_SIZE = 8;
var RACE_HUD_SCORE_SIZE = 13;
var RACE_HUD_GAUGE_W = 130;
var RACE_HUD_GAUGE_H = 8;

// On the same ink plate as the solo HUD, for the same reason: these digits
// used to be drawn in whatever colour the day/night fade had settled on, and
// the opponent's ghost-blue in particular had to survive both a pale sky and
// a near-black one. On a plate it only has to survive the plate.
function drawRaceScoreboard() {
  var showGauge = mpOpponentLiveScore !== null && !mpOpponentLeft;
  var plateWidth = RACE_HUD_GAUGE_W + HUD_PAD_X * 2;
  var contentHeight = RACE_HUD_SCORE_SIZE * 2 + 6 +
                      (showGauge ? RACE_HUD_GAUGE_H + RACE_HUD_LABEL_SIZE + 12 : 0);
  var plateHeight = contentHeight + HUD_PAD_Y * 2;
  var right = width - SCORE_MARGIN;
  var centerX = right - plateWidth / 2;
  var top = SCORE_MARGIN;

  drawInkCard(centerX, top + plateHeight / 2, plateWidth, plateHeight, 0.9);

  push();
  noStroke();
  textFont('"Press Start 2P", monospace');
  textAlign(RIGHT, TOP);
  var textRight = right - HUD_PAD_X;
  var rowY = top + HUD_PAD_Y;

  textSize(RACE_HUD_SCORE_SIZE);
  panelFill(PANEL_TEXT);
  text("YOU  " + padScore(score), textRight, rowY);
  rowY += RACE_HUD_SCORE_SIZE + 6;

  // Once they have crashed their score stops being a moving target and starts
  // being a finish line, so it says so. A forfeit is the exception: there is
  // no score left to beat, so showing their last live number as a target -
  // which is what "BEAT 0472" did - invents a race that is already over.
  var theirScore = mpOpponentLiveScore === null ? 0 : mpOpponentLiveScore;
  fill(GHOST_TINT[0], GHOST_TINT[1], GHOST_TINT[2]);
  if (mpOpponentLeft) {
    text("THEM  LEFT", textRight, rowY);
  } else {
    text((mpOpponentFinished ? "BEAT " : "THEM ") + padScore(theirScore), textRight, rowY);
  }
  rowY += RACE_HUD_SCORE_SIZE + 8;

  // The gap, which is the only number either player is actually tracking.
  // Suppressed before the opponent has reported anything, so it doesn't show
  // a meaningless lead during the countdown - and after a forfeit, when the
  // gap would grow against a number that stopped moving when they quit.
  if (showGauge) {
    var lead = Math.floor(score) - theirScore;
    drawLeadGauge(centerX, rowY + RACE_HUD_GAUGE_H / 2, RACE_HUD_GAUGE_W, RACE_HUD_GAUGE_H, lead);
    rowY += RACE_HUD_GAUGE_H + 6;

    textAlign(CENTER, TOP);
    textSize(RACE_HUD_LABEL_SIZE);
    if (lead > 0) {
      panelFill(PANEL_GOOD);
      text("+" + lead + " AHEAD", centerX, rowY);
    } else if (lead < 0) {
      panelFill(PANEL_BAD);
      text(lead + " BEHIND", centerX, rowY);
    } else {
      panelFill(PANEL_TEXT_DIM);
      text("LEVEL", centerX, rowY);
    }
  }
  pop();
}

function drawOpponentGoneBanner() {
  if (millis() > mpOpponentGoneBannerUntil) {
    return;
  }
  //on a plate, because this lands mid-run over whatever the world happens to
  //be showing - a cactus, the ground line, a sky halfway through a night fade
  drawInkCard(GAME_WIDTH / 2, 50, 344, 52);

  push();
  noStroke();
  textFont('"Press Start 2P", monospace');
  textAlign(CENTER, CENTER);

  // A forfeit is not a crash, and saying so matters: the player needs to know
  // the ghost that just vanished from beside them left rather than died, and
  // that there is no longer a score to chase.
  if (mpOpponentLeft) {
    panelFill(PANEL_BAD);
    textSize(13);
    text("OPPONENT LEFT", GAME_WIDTH / 2, 40);
    panelFill(PANEL_GOOD);
    textSize(9);
    text("RACE WON - FINISH YOUR RUN", GAME_WIDTH / 2, 62);
    pop();
    return;
  }

  panelFill(PANEL_BAD);
  textSize(13);
  text("OPPONENT CRASHED", GAME_WIDTH / 2, 40);

  // The race is decided on score, not on who is still standing - so once they
  // are out, a player already ahead of their final score has won outright and
  // cannot lose it by crashing. Saying "stay alive" there would be a lie.
  textSize(9);
  panelFill(PANEL_GOOD);
  if (Math.floor(score) > mpOpponentScore) {
    text("YOU'RE AHEAD - RACE WON", GAME_WIDTH / 2, 62);
  } else {
    text("BEAT " + padScore(mpOpponentScore) + " TO WIN", GAME_WIDTH / 2, 62);
  }
  pop();
}

// A rematch needs a live socket and an opponent still on the other end of it.
// After a forfeit or a dropped connection there is nobody to play, so the
// offer is withheld rather than shown and silently doing nothing.
function canRematch() {
  return !mpConnectionLost &&
         !mpOpponentLeft &&
         mpOpponentPresent &&
         mpSocket !== null &&
         mpSocket.readyState === WebSocket.OPEN;
}

function mpRequestRematch() {
  if (!canRematch() || mpRematchRequested) {
    return;
  }
  mpRematchRequested = true;
  mpSocket.send(JSON.stringify({ type: "rematch" }));
}

// ---------------------------------------------------------------------------
// Night-time outline
//
// The trex artwork is near-black, and night mode paints the sky (20,24,46) and
// the sand (60,56,48) nearly as dark - so the dino dissolved into the
// background for the whole night stretch, which is also when the game is at
// its fastest and least forgiving. A white outline behind the sprite keeps the
// silhouette readable without repainting the artwork itself.
//
// tint() cannot do this. It MULTIPLIES the image by the given colour, so
// tinting near-black artwork white leaves it near-black. The outline is
// instead a pre-built copy of the frame with every non-transparent pixel
// forced to white, stamped a couple of pixels out in eight directions behind
// the real sprite. Built once per image and cached, since it is pure pixel
// work that would otherwise repeat every frame.
// ---------------------------------------------------------------------------
var OUTLINE_DIRECTIONS = [[-1,-1],[0,-1],[1,-1],[-1,0],[1,0],[-1,1],[0,1],[1,1]];
var NIGHT_OUTLINE_PX = 2;

// Which artwork gets an outline is decided from the art itself rather than by
// naming sprites, so it stays correct if the assets ever change. Measuring the
// project's actual images against the night palette (sky luminance 24.7, sand
// 56.3) shows a wide natural gap:
//
//   crow      40.0   drawn darker than the sand it crosses, and barely above
//                    the night sky - effectively invisible, and it is the one
//                    obstacle that must be ducked
//   trex      83.9
//   boulder   90.7
//   ---------------- nothing lands between 91 and 138 ----------------
//   cacti    140-149  bright green, clearly readable against night sand
//
// So anything below 100 is outlined and the cacti are left exactly as they
// are, keeping the night look intact rather than rimming every sprite.
var NIGHT_OUTLINE_LUMINANCE_MAX = 100;

var nightOutlineCache = {};

// ---------------------------------------------------------------------------
// Drawing images cheaply
//
// p5 0.8.0's tint() is not a state flag the canvas honours - it is a pixel
// filter with no cache at all. Every single image() call made while a tint is
// set runs _getTintedImageCanvas(): a fresh <canvas> element, a full
// getImageData of the source, a new ImageData, and a loop over every pixel.
// Per call. The night outline used to make eight of those calls per outlined
// sprite per frame, and this game asks for frames as fast as the display will
// grant them - so on a 240Hz screen with a trex and four obstacles at night
// that was ~10,000 canvas allocations and full-image pixel passes a second,
// for an effect that is one flat colour.
//
// Alpha alone needs none of that. The 2D context has globalAlpha, which costs
// nothing and composites at draw time, so anything whose only tint is
// transparency is drawn between these two instead. tint() remains the
// fallback for environments without a drawingContext - the test harness is
// one, and it is what keeps the outline's behaviour covered either way.
//
// Not reentrant, by design: every caller draws a handful of images and ends,
// and a saved-state stack for something that never nests would be the kind of
// bookkeeping this whole block exists to remove.
var imageAlphaCtx = null;
var imageAlphaPrevious = 1;

function beginImageAlpha(alpha) {
  push();
  imageMode(CENTER);
  imageAlphaCtx = typeof drawingContext !== "undefined" ? drawingContext : null;
  if (imageAlphaCtx) {
    imageAlphaPrevious = imageAlphaCtx.globalAlpha;
    imageAlphaCtx.globalAlpha = imageAlphaPrevious * alpha;
  } else {
    tint(255, 255, 255, 255 * alpha);
  }
}

function endImageAlpha() {
  if (imageAlphaCtx) {
    imageAlphaCtx.globalAlpha = imageAlphaPrevious;
    imageAlphaCtx = null;
  }
  pop();
}

// A colour tint that never changes can be applied once, when the image is
// first cached, instead of on every frame it is drawn. The result is an
// ordinary image, so drawing it costs a plain blit.
var tintedImageCache = {};

function tintedImage(img, rgb) {
  if (img.__profileId === undefined) {
    img.__profileId = nextProfileId++;
  }
  var key = img.__profileId + ":" + rgb[0] + "," + rgb[1] + "," + rgb[2];
  var cached = tintedImageCache[key];
  if (cached) {
    return cached;
  }
  var g = createGraphics(img.width, img.height);
  g.clear();
  g.image(img, 0, 0);
  g.loadPixels();
  for (var i = 0; i < g.pixels.length; i += 4) {
    if (g.pixels[i + 3] > 0) {
      //the same multiply p5's own tint does, just done once rather than daily
      g.pixels[i] = (g.pixels[i] * rgb[0]) / 255;
      g.pixels[i + 1] = (g.pixels[i + 1] * rgb[1]) / 255;
      g.pixels[i + 2] = (g.pixels[i + 2] * rgb[2]) / 255;
    }
  }
  g.updatePixels();
  cached = g.get();
  tintedImageCache[key] = cached;
  return cached;
}

// Builds both the white stamp and the is-this-too-dark verdict in one pixel
// pass, since walking the image twice for two facts about the same pixels
// would be wasteful. Luminance is read BEFORE the pixel is overwritten white.
function nightOutlineInfo(img) {
  //shares imageProfile()'s per-image id, so both caches key off one identity
  if (img.__profileId === undefined) {
    img.__profileId = nextProfileId++;
  }
  var cached = nightOutlineCache[img.__profileId];
  if (cached) {
    return cached;
  }

  var g = createGraphics(img.width, img.height);
  g.clear();
  g.image(img, 0, 0);
  g.loadPixels();

  var luminanceSum = 0;
  var visiblePixels = 0;
  //stepping by 4 walks one RGBA pixel at a time whatever the pixel density is
  for (var i = 0; i < g.pixels.length; i += 4) {
    if (g.pixels[i + 3] > 0) {
      //Rec. 709 weighting - green carries most of perceived brightness
      luminanceSum += 0.2126 * g.pixels[i] +
                      0.7152 * g.pixels[i + 1] +
                      0.0722 * g.pixels[i + 2];
      visiblePixels++;
      g.pixels[i] = 255;
      g.pixels[i + 1] = 255;
      g.pixels[i + 2] = 255;
    }
  }
  g.updatePixels();

  cached = {
    silhouette: g.get(),
    isDark: visiblePixels > 0 &&
            (luminanceSum / visiblePixels) < NIGHT_OUTLINE_LUMINANCE_MAX
  };
  nightOutlineCache[img.__profileId] = cached;
  return cached;
}

function drawNightOutline(img, x, y, w, h, strength) {
  if (strength <= 0.02) {
    return;
  }
  var info = nightOutlineInfo(img);
  //bright artwork already reads fine against the night palette
  if (!info.isDark) {
    return;
  }
  var outline = info.silhouette;
  // Still eight stamps - the offsets are in destination pixels, so the
  // outline stays two pixels thick whatever scale the sprite is drawn at, and
  // baking them into the cached silhouette would make it thin out as sprites
  // shrink. Eight scaled blits of a small image are cheap; it was the tint
  // around them that was not.
  beginImageAlpha(strength);
  for (var i = 0; i < OUTLINE_DIRECTIONS.length; i++) {
    image(outline,
          x + OUTLINE_DIRECTIONS[i][0] * NIGHT_OUTLINE_PX,
          y + OUTLINE_DIRECTIONS[i][1] * NIGHT_OUTLINE_PX,
          w, h);
  }
  endImageAlpha();
}

// Deliberately reads the sprite's scale accessors rather than its width /
// height: those fold in the crouch stretch, so a ducking trex gets an outline
// matching its squashed shape instead of its standing one.
function drawSpriteNightOutline(sprite, strength) {
  if (!sprite.animation) {
    return;
  }
  var img = sprite.animation.getFrameImage();
  if (!img || !img.width) {
    return;
  }
  drawNightOutline(img, sprite.x, sprite.y,
                   img.width * Math.abs(sprite._getScaleX()),
                   img.height * Math.abs(sprite._getScaleY()),
                   strength);
}

// The crow is the reason this exists: it is drawn darker than the sand it
// flies over, and it is the only obstacle that has to be ducked rather than
// jumped, so failing to see one is an unavoidable death rather than a missed
// jump. Cacti are bright enough to be skipped automatically by the luminance
// test in nightOutlineInfo().
function drawObstacleNightOutlines() {
  if (nightAmount <= 0.02) {
    return;
  }
  for (var i = 0; i < obstaclesGroup.length; i++) {
    drawSpriteNightOutline(obstaclesGroup[i], nightAmount);
  }
}

// Dying at night freezes the fade wherever it was, so the Game Over screen is
// drawn over a dark sky. The artwork measures 61 against a night sky of 24.7 -
// a thinner margin than the trex had against the sand - so the same luminance
// rule catches it. The restart icon is far brighter and is skipped
// automatically, which is the point of deciding this from the art rather than
// by naming sprites.
function drawEndScreenNightOutlines() {
  if (nightAmount <= 0.02 || !gameOver.visible) {
    return;
  }
  drawSpriteNightOutline(gameOver, nightAmount);
  drawSpriteNightOutline(restart, nightAmount);
}

// What the run was worth, said at the moment the player is looking at the
// middle of the screen rather than only in the corner HUD. Deliberately
// placed ABOVE the GAME OVER art and not behind it: those sprites are dark
// pixels that are outlined in white at night precisely so they read against a
// dark background, and dropping an ink plate under them would make them
// invisible in daylight instead.
function drawGameOverStats() {
  var beatenBest = runStartHighScore > 0 && Math.floor(score) > runStartHighScore;
  drawInkCard(GAME_WIDTH / 2, 62, 300, 42);

  push();
  noStroke();
  textFont('"Press Start 2P", monospace');
  textAlign(CENTER, CENTER);

  textSize(10);
  panelFill(PANEL_TEXT);
  text("SCORE " + padScore(score), GAME_WIDTH / 2, 54);

  textSize(7);
  if (beatenBest) {
    fill(BUTTON_PRIMARY.hover[0], BUTTON_PRIMARY.hover[1], BUTTON_PRIMARY.hover[2], menuBlinkAlpha());
    text("NEW RECORD", GAME_WIDTH / 2, 72);
  } else {
    panelFill(PANEL_TEXT_DIM);
    text("BEST " + padScore(highScore), GAME_WIDTH / 2, 72);
  }
  pop();
}

function startRace() {
  mpResetRaceState();
  mpIsRacing = true;
  //the final, higher countdown tone - fired here rather than from the
  //countdown screen so it lands exactly once, on the frame the race begins
  playCountdownTick(true);
  //seeds the course from mpSeed via nextRunSeed(), and sets gameState to PLAY
  resetGame(PLAY);
}

//leaving a race for any reason - crashed out, quit early, or opponent gone
function leaveRace() {
  mpDisconnect();
  returnToMenu();
}

//onReady fires once the socket is actually open, since sending before then
//silently fails
// ---------------------------------------------------------------------------
// Connection timing
//
// Free hosting tiers sleep after a spell with no traffic and take the better
// part of a minute to wake. A browser gives no progress for an opening
// WebSocket, so the lobby simply read "Connecting..." for up to a minute with
// no way to tell a waking server from a broken one - and the natural
// conclusion is that the game is broken.
//
// So: say something once the wait stops looking instant, and give up
// eventually rather than hanging forever.
// ---------------------------------------------------------------------------
var MP_CONNECT_SLOW_MS = 3500;
var MP_CONNECT_TIMEOUT_MS = 60000;
var mpConnectStartedMillis = 0;
var mpSocketOpen = false;

//null when there is nothing worth saying yet
function mpConnectingNote() {
  if (mpSocketOpen || !mpSocket) {
    return null;
  }
  if (millis() - mpConnectStartedMillis < MP_CONNECT_SLOW_MS) {
    return null;
  }
  return "THE SERVER MAY BE WAKING UP";
}

//gives up on a connection that never opened, so the lobby cannot hang forever
function mpCheckConnectTimeout() {
  if (mpSocketOpen || !mpSocket) {
    return;
  }
  if (millis() - mpConnectStartedMillis < MP_CONNECT_TIMEOUT_MS) {
    return;
  }
  mpConnectionMessage = "Couldn't reach the server. Try again.";
  mpDisconnect();
  gameState = MULTIPLAYER_MENU;
}

function mpConnect(onReady) {
  mpConnectionMessage = null;
  mpConnectStartedMillis = millis();
  mpSocketOpen = false;
  try {
    mpSocket = new WebSocket(resolveServerUrl());
  } catch (e) {
    mpConnectionMessage = "Couldn't reach the multiplayer server.";
    return;
  }

  mpSocket.onopen = function () {
    mpSocketOpen = true;
    if (onReady) {
      onReady();
    }
  };
  mpSocket.onmessage = function (evt) {
    var msg;
    try {
      msg = JSON.parse(evt.data);
    } catch (e) {
      return; //ignore malformed messages rather than crash the game
    }
    mpHandleMessage(msg);
  };
  mpSocket.onerror = function () {
    mpConnectionMessage = "Couldn't reach the multiplayer server.";
  };
  mpSocket.onclose = function () {
    // A close that wasn't triggered by our own mpDisconnect() - which nulls
    // these handlers first - means the server or the network dropped us.
    //
    // This has to cover a drop DURING a race, not just one on the lobby
    // screen. Nothing about the local simulation depends on the socket, so a
    // dead connection is invisible from inside the game: the player would keep
    // running, alone, against an opponent frozen mid-stride, and find out only
    // when the result never came. Free hosting tiers idle their sockets out,
    // so this is a routine event rather than an exotic one.
    mpOpponentPresent = false;

    // Both scores are already in and the result is on screen. The socket is
    // only needed for a rematch from here, so losing it must not relabel a
    // decided race as unscoreable - that would throw away a real result (and
    // overwrite the scores with the frozen world's) for a connection nobody
    // needs any more.
    if (gameState === MULTIPLAYER_RESULT && mpOpponentFinished) {
      return;
    }

    if (mpIsRacing || gameState === MULTIPLAYER_COUNTDOWN) {
      mpConnectionLost = true;
      //stop the result screen waiting for a score that can no longer arrive
      mpOpponentFinished = true;
      mpSelfScore = Math.floor(score);
      gameState = MULTIPLAYER_RESULT;
    } else if (gameState === MULTIPLAYER_WAITING) {
      mpConnectionMessage = mpConnectionMessage || "Lost connection to the server.";
      //the socket is dead and the room went with it - tear the session down
      //rather than leaving a closed socket and a stale room code behind for
      //the next screen to trip over
      mpDisconnect();
      gameState = MULTIPLAYER_MENU;
    }
  };
}

// ---------------------------------------------------------------------------
// Shareable room links
//
// Typing a 4-character code into a phone is the most annoying part of getting
// a race started, so a room is also reachable as a plain URL: the same page
// with ?room=CODE on the end. That turns "read this out to me" into sending a
// link over any chat app, and it costs nothing, because the server already
// hosts the page (see the static-hosting block in server/server.js) so the
// address the second device needs is just this page's own.
// ---------------------------------------------------------------------------
function roomShareUrl(code) {
  var loc = window.location;
  //a page opened straight off the disk has no address anyone else can reach
  if (loc.protocol === "file:" || !loc.host) {
    return null;
  }
  return loc.origin + loc.pathname + "?room=" + code;
}

// The invite link, for the host only. A joiner has nothing to share: the room
// they are connecting to is about to be full, so passing its link on could
// only send a third person to "That room is already full."
function hostShareUrl() {
  if (!mpRoomCode || mpJoining) {
    return null;
  }
  return roomShareUrl(mpRoomCode);
}

function readRoomFromUrl() {
  var match = /[?&]room=([A-Za-z0-9]{4})(?:&|$)/.exec(window.location.search);
  return match ? match[1].toUpperCase() : null;
}

// An invite link is single use, and not by choice: the server drops a room as
// soon as either seat empties, so by the time anyone reloads the page, the
// code in the address bar names a room that no longer exists. Left there, a
// refresh - or the browser restoring the tab tomorrow - auto-joins a dead
// room and lands on "Room not found." every time, with no way back to a
// normal start except editing the URL by hand. So the code is taken out of
// the address once it has been used, without adding a history entry.
function clearRoomFromUrl() {
  try {
    if (!window.history || !window.history.replaceState) {
      return;
    }
    var search = window.location.search.replace(/([?&])room=[A-Za-z0-9]{4}(&|$)/, "$1");
    //tidy up whatever the removal left behind
    search = search.replace(/[?&]$/, "");
    if (search && search.charAt(0) !== "?") {
      search = "?" + search;
    }
    window.history.replaceState(null, "", window.location.pathname + search);
  } catch (e) {
    //a sandboxed or file:// page may refuse; the link simply stays put
  }
}

//how long the "LINK COPIED" confirmation stays up
var SHARE_COPIED_MS = 1600;
var shareCopiedUntilMillis = 0;

function copyRoomLink(text) {
  // The async clipboard API is only available in a secure context, and a game
  // served over plain http to a phone on the local network is not one - which
  // is exactly the case this feature exists for. So fall back to the old
  // execCommand path rather than silently doing nothing on the LAN.
  if (navigator.clipboard && window.isSecureContext) {
    navigator.clipboard.writeText(text).then(function () {
      shareCopiedUntilMillis = millis() + SHARE_COPIED_MS;
    }, function () {});
    return;
  }

  var area = document.createElement("textarea");
  area.value = text;
  //keep it off-screen and non-scrolling, so copying doesn't visibly jump the page
  area.style.position = "fixed";
  area.style.top = "-1000px";
  document.body.appendChild(area);
  area.select();
  try {
    if (document.execCommand("copy")) {
      shareCopiedUntilMillis = millis() + SHARE_COPIED_MS;
    }
  } catch (e) {
    //no clipboard access at all - the link is still displayed to read off
  }
  document.body.removeChild(area);
}

function mpCreateRoom() {
  mpJoining = false;
  mpConnect(function () {
    mpSocket.send(JSON.stringify({ type: "create" }));
  });
}

function mpJoinRoom(code) {
  //shown immediately so the waiting screen has a room code to display for
  //the joiner too, same as the creator gets back from the "created" message
  mpRoomCode = code;
  mpJoining = true;
  mpConnect(function () {
    mpSocket.send(JSON.stringify({ type: "join", room: code }));
  });
}

// ---------------------------------------------------------------------------
// Main menu - single player vs multiplayer
//
// Buttons are stored as {x, y, w, h} centered rectangles (matching how
// sprite x/y already work in this file) so the same hit-test works for
// pointer clicks/taps regardless of which screen is showing them.
// ---------------------------------------------------------------------------
var MENU_SINGLE_PLAYER_BUTTON = { x: 300, y: 110, w: 240, h: 32 };
var MENU_MULTIPLAYER_BUTTON = { x: 300, y: 152, w: 240, h: 32 };
var MENU_BACK_BUTTON = { x: 300, y: 175, w: 160, h: 30 };
var MULTIPLAYER_CREATE_BUTTON = { x: 300, y: 95, w: 240, h: 32 };
var MULTIPLAYER_JOIN_BUTTON = { x: 300, y: 135, w: 240, h: 32 };
var MULTIPLAYER_LEAVE_BUTTON = { x: 300, y: 172, w: 160, h: 28 };
//screens offering two choices get a side-by-side pair rather than the single
//centered button the simpler lobby screens use
var RESULT_REMATCH_BUTTON = { x: 213, y: 172, w: 150, h: 28 };
var RESULT_MENU_BUTTON = { x: 387, y: 172, w: 150, h: 28 };
var WAITING_COPY_BUTTON = { x: 213, y: 172, w: 150, h: 28 };
var WAITING_LEAVE_BUTTON = { x: 387, y: 172, w: 150, h: 28 };
var MULTIPLAYER_JOIN_SUBMIT_BUTTON = { x: 300, y: 140, w: 160, h: 30 };
//below the restart icon (centered at 300,140, ~32px tall) on the game-over screen
var END_MENU_BUTTON = { x: 300, y: 180, w: 110, h: 24 };

// ---------------------------------------------------------------------------
// HUD controls
//
// Mute and pause were keyboard-only - M and P - which meant that on a phone,
// where this game is most likely to be played and where it is most likely to
// be playing sound at a bad moment, neither existed at all. There was no way
// to silence it and no way to stop it.
//
// They live in the top-left of the playfield, the one corner nothing else
// uses: the score plate is pinned right, the overlay panels start at x=98,
// and the trex runs in from x=50 at ground level.
// ---------------------------------------------------------------------------
var MUTE_BUTTON = { x: 26, y: 22, w: 26, h: 26 };
var PAUSE_BUTTON = { x: 58, y: 22, w: 26, h: 26 };

//pause is meaningless outside a run, and a race must never be pausable - the
//opponent keeps running on their own machine, so it would only ever hand the
//pauser thinking time they have not earned
function pauseControlIsAvailable() {
  return (gameState === PLAY || gameState === PAUSED) && !mpIsRacing;
}

function hudControlsOnScreen() {
  return pauseControlIsAvailable() ? [MUTE_BUTTON, PAUSE_BUTTON] : [MUTE_BUTTON];
}

// The floor for how far outside the slab still counts as a hit. Vertically
// this is exactly BUTTON_LIFT, because the slab is drawn with its shadow that
// far below the box - without it the bottom few pixels of what the player can
// see are dead.
var BUTTON_HIT_PAD_X = 6;
var BUTTON_HIT_PAD_Y = 3;

// ---------------------------------------------------------------------------
// Touch targets
//
// A button 32 game units tall is 32 CSS pixels only on a screen showing the
// canvas at 1:1. On a 390px-wide phone the canvas is scaled to 0.65, so that
// same button is 21 CSS pixels - under half the ~44 a fingertip can reliably
// land on. Every near miss then reads as the button being in the wrong place
// rather than as the button being small, which is the worse of the two
// complaints because there is nothing the player can do about it.
//
// So a hit box grows towards that minimum - but never into a neighbour. Each
// button may claim at most half the empty space between itself and the next
// thing on the screen, which means the boxes can meet but never overlap and
// no tap is ever ambiguous. Growth is clamped on whichever axis the two are
// actually separated on: buttons stacked in a column must not reach for each
// other vertically, but either may grow as wide as it likes.
// ---------------------------------------------------------------------------
var MIN_TOUCH_TARGET_CSS_PX = 44;

//how many game units one CSS pixel covers - see fillScreen()
var unitsPerCssPixel = 1;

//written by computeButtonHitPad(), read straight after; a returned object
//would allocate on every hit test, of which there are several per frame
var hitPadX = BUTTON_HIT_PAD_X;
var hitPadY = BUTTON_HIT_PAD_Y;

function clampHitPadAgainst(button, otherX, otherY, otherW, otherH) {
  var gapX = Math.abs(otherX - button.x) - (button.w + otherW) / 2;
  var gapY = Math.abs(otherY - button.y) - (button.h + otherH) / 2;
  if (gapY >= gapX) {
    hitPadY = Math.min(hitPadY, Math.max(0, gapY / 2));
  } else {
    hitPadX = Math.min(hitPadX, Math.max(0, gapX / 2));
  }
}

function computeButtonHitPad(button) {
  var minSize = MIN_TOUCH_TARGET_CSS_PX * unitsPerCssPixel;
  hitPadX = Math.max(BUTTON_HIT_PAD_X, (minSize - button.w) / 2);
  hitPadY = Math.max(BUTTON_HIT_PAD_Y, (minSize - button.h) / 2);

  var neighbours = buttonsOnScreen();
  for (var i = 0; i < neighbours.length; i++) {
    if (neighbours[i] !== button) {
      clampHitPadAgainst(button, neighbours[i].x, neighbours[i].y,
                         neighbours[i].w, neighbours[i].h);
    }
  }
  // The restart icon is not in that list - it is a sprite, not a button - but
  // it is very much a target, and it sits directly above the game-over MENU
  // button. Left out, MENU would grow up over it on a narrow phone.
  if (restart && restart.visible) {
    clampHitPadAgainst(button, restart.x, restart.y,
                       restart.width * restart.scale, restart.height * restart.scale);
  }
}

function isOverButton(button, x, y) {
  computeButtonHitPad(button);
  return Math.abs(x - button.x) <= button.w / 2 + hitPadX &&
         Math.abs(y - button.y) <= button.h / 2 + hitPadY;
}

//consumed in draw() rather than acted on immediately, same reasoning as
//restartRequested: pointer events fire outside p5's draw loop
var menuSinglePlayerRequested = false;
var menuMultiplayerRequested = false;
var menuBackRequested = false;
var multiplayerCreateRequested = false;
var multiplayerJoinRequested = false;
var multiplayerJoinSubmitRequested = false;
var multiplayerLeaveRequested = false;
var multiplayerRematchRequested = false;
var endMenuRequested = false;
var muteRequested = false;
var pauseRequested = false;

//only a real mouse hovers - see the comment on pointerGamePos
function onCanvasPointerMove(evt) {
  if (evt.pointerType && evt.pointerType !== "mouse" && evt.pointerType !== "pen") {
    return;
  }
  pointerGamePos = canvasPointerToGame(evt);
}

function onCanvasPointerLeave() {
  pointerGamePos = null;
}

function onPointerRelease() {
  pressedButton = null;
}

// Every button this screen is currently showing, so a press can be attributed
// to one without each screen repeating its own hit-testing. Order matters only
// in that no two buttons overlap on any one screen.
//the screen's own buttons, plus the mute/pause controls that outlive any one
//screen - so presses, hover, and the touch-target clamp all treat them alike
function buttonsOnScreen() {
  return hudControlsOnScreen().concat(screenButtons());
}

function screenButtons() {
  if (gameState === MENU) {
    return [MENU_SINGLE_PLAYER_BUTTON, MENU_MULTIPLAYER_BUTTON];
  }
  if (gameState === MULTIPLAYER_MENU) {
    return [MULTIPLAYER_CREATE_BUTTON, MULTIPLAYER_JOIN_BUTTON, MENU_BACK_BUTTON];
  }
  if (gameState === MULTIPLAYER_JOIN_ENTRY) {
    return [MULTIPLAYER_JOIN_SUBMIT_BUTTON, MENU_BACK_BUTTON];
  }
  if (gameState === MULTIPLAYER_WAITING) {
    return hostShareUrl()
      ? [WAITING_COPY_BUTTON, WAITING_LEAVE_BUTTON]
      : [MULTIPLAYER_LEAVE_BUTTON];
  }
  if (gameState === MULTIPLAYER_COUNTDOWN) {
    return [MULTIPLAYER_LEAVE_BUTTON];
  }
  if (gameState === MULTIPLAYER_RESULT) {
    return canRematch() && !mpRematchRequested
      ? [RESULT_REMATCH_BUTTON, RESULT_MENU_BUTTON]
      : [MULTIPLAYER_LEAVE_BUTTON];
  }
  if (gameState === END) {
    return [END_MENU_BUTTON];
  }
  return [];
}

function onCanvasPointerDown(evt) {
  var point = canvasPointerToGame(evt);
  if (!point) {
    return;
  }

  //so the slab visibly sinks for as long as the pointer is held down
  var visible = buttonsOnScreen();
  for (var i = 0; i < visible.length; i++) {
    if (isOverButton(visible[i], point.x, point.y)) {
      pressedButton = visible[i];
      break;
    }
  }

  // Checked before anything else, and returning: these two sit on top of
  // every screen, so a press on one is never also a press on whatever that
  // screen has underneath.
  if (isOverButton(MUTE_BUTTON, point.x, point.y)) {
    muteRequested = true;
    return;
  }
  if (pauseControlIsAvailable() && isOverButton(PAUSE_BUTTON, point.x, point.y)) {
    pauseRequested = true;
    return;
  }

  if (isOverRestart(point.x, point.y)) {
    restartRequested = true;
  } else if (gameState === END) {
    if (isOverButton(END_MENU_BUTTON, point.x, point.y)) {
      endMenuRequested = true;
    }
  } else if (gameState === MENU) {
    if (isOverButton(MENU_SINGLE_PLAYER_BUTTON, point.x, point.y)) {
      menuSinglePlayerRequested = true;
    } else if (isOverButton(MENU_MULTIPLAYER_BUTTON, point.x, point.y)) {
      menuMultiplayerRequested = true;
    }
  } else if (gameState === MULTIPLAYER_MENU) {
    if (isOverButton(MULTIPLAYER_CREATE_BUTTON, point.x, point.y)) {
      multiplayerCreateRequested = true;
    } else if (isOverButton(MULTIPLAYER_JOIN_BUTTON, point.x, point.y)) {
      multiplayerJoinRequested = true;
      // Shown here as well as from draw(), for the same reason the clipboard
      // write below happens inline: a mobile browser only opens its on-screen
      // keyboard for a focus() that happens inside the tap that asked for it.
      // Deferred to the next animation frame, the field appeared with nothing
      // to type into it, and a phone player had to work out for themselves
      // that tapping the field again was what opened the keyboard.
      showRoomCodeInput();
    } else if (isOverButton(MENU_BACK_BUTTON, point.x, point.y)) {
      menuBackRequested = true;
    }
  } else if (gameState === MULTIPLAYER_WAITING) {
    var shareUrl = hostShareUrl();
    if (shareUrl) {
      if (isOverButton(WAITING_COPY_BUTTON, point.x, point.y)) {
        // Copied right here rather than via a flag consumed in draw(), the way
        // every other button works. Clipboard writes need transient user
        // activation, and by the time the next animation frame runs the
        // browser no longer considers this a user gesture - so the deferred
        // route would be refused.
        copyRoomLink(shareUrl);
      } else if (isOverButton(WAITING_LEAVE_BUTTON, point.x, point.y)) {
        multiplayerLeaveRequested = true;
      }
    } else if (isOverButton(MULTIPLAYER_LEAVE_BUTTON, point.x, point.y)) {
      multiplayerLeaveRequested = true;
    }
  } else if (gameState === MULTIPLAYER_COUNTDOWN) {
    if (isOverButton(MULTIPLAYER_LEAVE_BUTTON, point.x, point.y)) {
      multiplayerLeaveRequested = true;
    }
  } else if (gameState === MULTIPLAYER_RESULT) {
    // Which buttons are actually on screen depends on whether a rematch is
    // still possible, so the hit-test has to agree with what was drawn -
    // otherwise the centered MENU button would overlap a stale REMATCH box.
    if (canRematch() && !mpRematchRequested) {
      if (isOverButton(RESULT_REMATCH_BUTTON, point.x, point.y)) {
        multiplayerRematchRequested = true;
      } else if (isOverButton(RESULT_MENU_BUTTON, point.x, point.y)) {
        multiplayerLeaveRequested = true;
      }
    } else if (isOverButton(MULTIPLAYER_LEAVE_BUTTON, point.x, point.y)) {
      multiplayerLeaveRequested = true;
    }
  } else if (gameState === MULTIPLAYER_JOIN_ENTRY) {
    if (isOverButton(MULTIPLAYER_JOIN_SUBMIT_BUTTON, point.x, point.y)) {
      multiplayerJoinSubmitRequested = true;
    } else if (isOverButton(MENU_BACK_BUTTON, point.x, point.y)) {
      menuBackRequested = true;
    }
  }
}

// ---------------------------------------------------------------------------
// Buttons
//
// Drawn as raised slabs that light up under the cursor and visibly depress
// when pressed. Before this they were flat rectangles that never acknowledged
// the pointer at all, so on a screen of several there was nothing telling you
// which one you were about to hit, or whether a click had registered.
//
// The look is pixel-art arcade rather than web-app: square corners, a heavy
// ink keyline, and a hard two-tone bevel (light along the top, shadow along
// the bottom) instead of a soft gradient. Rounded corners and soft edges read
// as a form control in a browser, which is the one thing the rest of this
// screen - a chunky monospace pixel font over a cactus desert - is not.
//
// PRIMARY is the action the screen exists for; SUBTLE is the way out (back,
// leave, menu) so the two never compete for attention. The palette is pulled
// from the world the buttons sit on: desert sun, cactus green, weathered
// stone, all keylined in the same near-black ink.
// ---------------------------------------------------------------------------
var BUTTON_PRIMARY = { idle: [216, 126, 42], hover: [244, 158, 62], press: [166, 92, 26] };
var BUTTON_SUBTLE = { idle: [112, 102, 88], hover: [142, 130, 112], press: [82, 74, 62] };
var BUTTON_POSITIVE = { idle: [66, 148, 74], hover: [92, 182, 98], press: [46, 110, 52] };

//the keyline around every slab and panel, and the colour text is shadowed in
var INK = [26, 22, 20];

//how far the slab sits above its shadow, and how far it sinks when pressed
var BUTTON_LIFT = 3;
//thickness of the ink keyline drawn around the slab
var BUTTON_EDGE = 2;

// Pointer position in gameplay-strip coordinates, or null when the pointer is
// elsewhere. Only ever set for a real mouse: a touchscreen has no hover, and
// tracking taps here would leave a button stuck looking highlighted long after
// the finger had gone.
var pointerGamePos = null;
//the button currently held down, so it can be drawn depressed
var pressedButton = null;
//set by drawButton() each frame, read after drawing to pick the CSS cursor
var pointerIsOverButton = false;

// ---------------------------------------------------------------------------
// Overlay panel
//
// A dark card behind the lobby and result screens. Their text used to sit
// straight on the world, which meant it had to be recoloured for day and night
// and still landed on whatever happened to be behind it - a cactus, the ground
// line, a frozen crash scene. A panel gives every one of those screens one
// predictable dark background, so the text is a fixed set of colours that is
// readable no matter what the game is doing underneath.
// ---------------------------------------------------------------------------
var OVERLAY_PANEL = { x: 300, y: 94, w: 404, h: 136 };

//bone white on dark ink, the way a cabinet's attract screen prints its text
var PANEL_TEXT = [247, 241, 226];
var PANEL_TEXT_DIM = [166, 156, 138];
var PANEL_GOOD = [124, 204, 112];
var PANEL_BAD = [232, 100, 82];
var PANEL_BODY = [30, 26, 24];

// One plate shape for every card in the game - the lobby panel, the pause
// box, the controls hint, the muted badge. Square-cornered, ink-keylined, and
// dropped onto a hard unblurred shadow. Each of these used to draw its own
// rounded translucent box with its own corner radius and its own dark grey,
// so the screens never looked like parts of the same machine.
//
// Everything is alpha-scaled by `fade` so a caller can animate the whole
// plate in or out (the controls hint does) without knowing what it is made of.
function drawInkCard(x, y, w, h, fade) {
  var alpha = fade === undefined ? 1 : fade;
  push();
  rectMode(CENTER);
  noStroke();
  //hard offset shadow, no blur - a soft one would be the only soft edge here
  fill(0, 0, 0, 90 * alpha);
  rect(x + 4, y + 5, w, h);
  fill(INK[0], INK[1], INK[2], 240 * alpha);
  rect(x, y, w + 6, h + 6);
  fill(PANEL_BODY[0], PANEL_BODY[1], PANEL_BODY[2], 236 * alpha);
  rect(x, y, w, h);
  pop();
}

// The lobby and result plate: drawInkCard plus a bone rule inset from the
// edge. That rule is what makes the card read as a marquee panel rather than
// a dialog - it catches the eye at the edges the way a cabinet bezel does, and
// being a fixed colour it works over a bright day sky and a black night one
// alike.
function drawOverlayPanel() {
  var x = OVERLAY_PANEL.x, y = OVERLAY_PANEL.y, w = OVERLAY_PANEL.w, h = OVERLAY_PANEL.h;
  drawInkCard(x, y, w, h);

  push();
  rectMode(CENTER);
  noStroke();
  //four thin bars rather than an outlined rect, so the middle stays clear
  fill(PANEL_TEXT[0], PANEL_TEXT[1], PANEL_TEXT[2], 46);
  var inset = 7;
  rect(x, y - h / 2 + inset, w - inset * 2, 2);
  rect(x, y + h / 2 - inset, w - inset * 2, 2);
  rect(x - w / 2 + inset, y, 2, h - inset * 2);
  rect(x + w / 2 - inset, y, 2, h - inset * 2);
  pop();
}

//every overlay screen starts from the same font and alignment
function beginPanelText() {
  push();
  textFont('"Press Start 2P", monospace');
  textAlign(CENTER, CENTER);
}

// A screen's verdict, set the same way the menu title is: a flat ink layer
// under a coloured one. On a panel this dark, PANEL_BAD red on its own is
// close to the same value as the card behind it, and the result of a race
// should not be the hardest thing on the screen to read.
function panelHeadline(label, y, rgb, size) {
  textSize(size);
  fill(INK[0], INK[1], INK[2]);
  text(label, GAME_WIDTH / 2 + 2, y + 2);
  panelFill(rgb);
  text(label, GAME_WIDTH / 2, y);
}

function panelFill(rgb) {
  fill(rgb[0], rgb[1], rgb[2]);
}

function buttonIsHovered(button) {
  return pointerGamePos !== null &&
         isOverButton(button, pointerGamePos.x, pointerGamePos.y);
}

// Draws the slab and returns the y its face ended up at, so whatever goes on
// top - a label, an icon - sinks with it.
function drawButtonSlab(button, palette) {
  var colors = palette || BUTTON_PRIMARY;
  var hovered = buttonIsHovered(button);
  var pressed = pressedButton === button;
  if (hovered) {
    pointerIsOverButton = true;
  }

  var shade = pressed ? colors.press : (hovered ? colors.hover : colors.idle);
  //pressing drops the slab onto its shadow, which is what sells the click
  var slabY = button.y + (pressed ? BUTTON_LIFT : 0);

  push();
  rectMode(CENTER);
  noStroke();

  //the hole the slab sits in, still visible under it until the slab drops
  fill(0, 0, 0, 80);
  rect(button.x, button.y + BUTTON_LIFT, button.w, button.h);

  // The keyline is drawn as a slightly larger rect behind the slab rather
  // than with stroke(): p5 strokes straddle the edge, so a 2px stroke would
  // eat a pixel of the fill and leave the bevel bands below misaligned with
  // the slab they are meant to sit inside.
  fill(INK[0], INK[1], INK[2]);
  rect(button.x, slabY, button.w + BUTTON_EDGE * 2, button.h + BUTTON_EDGE * 2);

  fill(shade[0], shade[1], shade[2]);
  rect(button.x, slabY, button.w, button.h);

  //hard two-tone bevel: lit along the top, in shadow along the bottom. Both
  //flatten when pressed, which is most of what sells the slab going down.
  var bandHeight = Math.max(2, Math.round(button.h / 5));
  var bandWidth = button.w - 6;
  fill(255, 255, 255, pressed ? 18 : 46);
  rect(button.x, slabY - button.h / 2 + bandHeight / 2 + 1, bandWidth, bandHeight);
  fill(0, 0, 0, pressed ? 20 : 54);
  rect(button.x, slabY + button.h / 2 - bandHeight / 2 - 1, bandWidth, bandHeight);
  pop();
  return slabY;
}

function drawButton(button, label, palette) {
  var slabY = drawButtonSlab(button, palette);
  push();
  noStroke();
  textFont('"Press Start 2P", monospace');
  textAlign(CENTER, CENTER);
  textSize(10);
  //one pixel of ink under the label, so it stays readable on the lighter
  //hover shade without needing a second colour for it
  fill(INK[0], INK[1], INK[2], 150);
  text(label, button.x + 1, slabY + 2);
  fill(255, 252, 244);
  text(label, button.x, slabY + 1);
  pop();
}

// ---------------------------------------------------------------------------
// HUD control icons
//
// Built from axis-aligned rectangles rather than from triangle() or a font
// glyph. At this size - about fourteen pixels across, drawn on a canvas that
// is then scaled by whatever the screen is - anything with a diagonal edge
// turns into a grey smear, and the rest of the game is hard pixel edges.
// Stacking bars of decreasing height gives a play arrow that stays crisp.
// ---------------------------------------------------------------------------
var ICON_FILL = [255, 252, 244];

function beginIcon() {
  push();
  rectMode(CENTER);
  noStroke();
  fill(ICON_FILL[0], ICON_FILL[1], ICON_FILL[2]);
}

function drawSpeakerIcon(x, y, muted) {
  beginIcon();
  //a squat box and a taller one make a speaker without a single diagonal
  rect(x - 5, y, 4, 6);
  rect(x - 2, y, 3, 12);
  if (muted) {
    //a bar straight through where the sound would have been
    fill(INK[0], INK[1], INK[2]);
    rect(x + 1, y, 12, 3);
    fill(ICON_FILL[0], ICON_FILL[1], ICON_FILL[2]);
    rect(x + 1, y, 12, 2);
  } else {
    rect(x + 3, y, 2, 6);
    rect(x + 6, y, 2, 11);
  }
  pop();
}

function drawPauseIcon(x, y, paused) {
  beginIcon();
  if (paused) {
    //a play arrow as four bars, tallest first
    rect(x - 4, y, 2, 12);
    rect(x - 2, y, 2, 9);
    rect(x, y, 2, 6);
    rect(x + 2, y, 2, 3);
  } else {
    rect(x - 3, y, 3, 12);
    rect(x + 3, y, 3, 12);
  }
  pop();
}

// Muting is a state you can sit in for a whole session, so its button carries
// the state rather than a separate badge appearing beside it - the control
// and the indicator being two different things was one thing too many in a
// corner this small.
function drawHudControls() {
  var muteSlabY = drawButtonSlab(MUTE_BUTTON, soundMuted ? BUTTON_SUBTLE : BUTTON_POSITIVE);
  drawSpeakerIcon(MUTE_BUTTON.x, muteSlabY, soundMuted);

  if (pauseControlIsAvailable()) {
    var pauseSlabY = drawButtonSlab(PAUSE_BUTTON, BUTTON_SUBTLE);
    drawPauseIcon(PAUSE_BUTTON.x, pauseSlabY, gameState === PAUSED);
  }
}

// ---------------------------------------------------------------------------
// Menu - an arcade attract screen
//
// The title used to be flat text with a soft grey shadow, recoloured between
// white and black to survive the day/night sky behind it. A cabinet doesn't
// do that: it prints one bone-white title on a hard ink offset, which reads
// against anything, and it never sits still - the demo keeps running behind
// the marquee. Both of those are what this screen is now.
// ---------------------------------------------------------------------------

//how fast the world drifts by on the menu - a gentle jog, well under the
//BASE_SPEED a real run opens at, so the menu reads as idling rather than racing
var MENU_SCROLL_SPEED = 2.4;
//full on/off cycle of the blinking prompt, in ms
var MENU_BLINK_MS = 1100;

// Never blinks fully out. A prompt that vanishes completely for half a second
// reads as a rendering fault on a screen this small; dropping to a dim shade
// still reads as an arcade blink.
function menuBlinkAlpha() {
  return (millis() % MENU_BLINK_MS) < MENU_BLINK_MS / 2 ? 255 : 90;
}

// The attract screen runs instead of freezing. The dino's own animation is
// already looping, so scrolling the ground under it is the whole trick - it
// stops looking like a paused game and starts looking like one waiting for a
// player. Deliberately kept off every gameplay counter: no score, no
// distance, no obstacle spawning, so sitting on the menu costs a run nothing.
function updateMenuScenery(dtFactor) {
  ground.velocityX = -MENU_SCROLL_SPEED * dtFactor;
  if (ground.x < 0) {
    ground.x = ground.width / 2;
  }
}

//the ground keeps whatever velocity it was last given, so leaving the menu
//has to put it back - every other non-play screen shows a still world
function stopMenuScenery() {
  ground.velocityX = 0;
}

function drawMenuScreen() {
  push();
  textFont('"Press Start 2P", monospace');
  textAlign(CENTER, CENTER);
  noStroke();
  rectMode(CENTER);

  // Two flat layers, ink under bone, rather than a blurred shadow. The offset
  // is 3px because that is the same lift the buttons use, so the title and
  // the slabs below it look like they are standing off the same surface.
  textSize(20);
  fill(INK[0], INK[1], INK[2]);
  text("T-REX RUNNER", GAME_WIDTH / 2 + 3, 43 + 3);
  panelFill(PANEL_TEXT);
  text("T-REX RUNNER", GAME_WIDTH / 2, 43);

  //the marquee's colour comes from a bar under the title rather than from the
  //letters, which keeps the title itself readable over any sky
  fill(INK[0], INK[1], INK[2]);
  rect(GAME_WIDTH / 2 + 2, 58 + 2, 250, 4);
  fill(BUTTON_PRIMARY.idle[0], BUTTON_PRIMARY.idle[1], BUTTON_PRIMARY.idle[2]);
  rect(GAME_WIDTH / 2, 58, 250, 4);

  //rules either side of the strapline, the way a cabinet bezel breaks up a row
  fill(INK[0], INK[1], INK[2], 130);
  rect(136, 76, 104, 2);
  rect(464, 76, 104, 2);
  textSize(7);
  fill(INK[0], INK[1], INK[2], 210);
  text("RACE A FRIEND ON TWO DEVICES", GAME_WIDTH / 2, 76);
  pop();

  drawButton(MENU_SINGLE_PLAYER_BUTTON, "SINGLE PLAYER");
  drawButton(MENU_MULTIPLAYER_BUTTON, "MULTIPLAYER");

  // The number keys already work as shortcuts; nothing said so until now.
  // Only a keyboard player is told: a phone has no 1, 2 or F to press, and the
  // buttons above are already the whole instruction there - see
  // playerIsOnTouch. Set on the plain sand below the ground line rather than
  // on it, where the pebbles in the ground art broke up the letters.
  if (!playerIsOnTouch) {
    push();
    textFont('"Press Start 2P", monospace');
    textAlign(CENTER, CENTER);
    textSize(7);
    fill(INK[0], INK[1], INK[2], menuBlinkAlpha());
    text("PRESS 1 OR 2   -   F FOR FULLSCREEN", GAME_WIDTH / 2, 193);
    pop();
  }
}

// ---------------------------------------------------------------------------
// Room code tiles
//
// The code is the one thing on this screen that gets read out loud down a
// phone line, so it is set as four separate split-flap tiles rather than as a
// four-character word. Separating the characters is what makes a code
// readable: as one run of large text, O/0 and I/1 are a coin toss, and a
// listener has no idea where one character ends and the next begins. A tile
// each, with a seam across the middle, says "these are four symbols" before
// anyone has read one of them.
//
// The same tile row doubles as the connecting indicator, with one tile lit and
// travelling along the row - so the wait for a code and the code itself are
// the same object filling up, rather than two unrelated screens.
// ---------------------------------------------------------------------------
var CODE_TILE_W = 40;
var CODE_TILE_H = 46;
var CODE_TILE_GAP = 8;
var CODE_TILE_FACE = [14, 12, 11];
//how long each tile stays lit as the connecting light travels the row
var CONNECT_TILE_STEP_MS = 220;

function codeTileX(index, count, centerX) {
  var total = count * CODE_TILE_W + (count - 1) * CODE_TILE_GAP;
  return centerX - total / 2 + CODE_TILE_W / 2 + index * (CODE_TILE_W + CODE_TILE_GAP);
}

function drawCodeTile(x, y, character, lit) {
  push();
  rectMode(CENTER);
  noStroke();

  fill(0, 0, 0, 70);
  rect(x + 2, y + 3, CODE_TILE_W, CODE_TILE_H);
  fill(INK[0], INK[1], INK[2]);
  rect(x, y, CODE_TILE_W + 4, CODE_TILE_H + 4);
  if (lit) {
    fill(BUTTON_PRIMARY.idle[0], BUTTON_PRIMARY.idle[1], BUTTON_PRIMARY.idle[2]);
  } else {
    fill(CODE_TILE_FACE[0], CODE_TILE_FACE[1], CODE_TILE_FACE[2]);
  }
  rect(x, y, CODE_TILE_W, CODE_TILE_H);

  //lit band along the top, so the tile face is not a flat black hole
  fill(255, 255, 255, lit ? 50 : 20);
  rect(x, y - CODE_TILE_H / 2 + 6, CODE_TILE_W - 6, 8);
  //the seam a split-flap tile hinges on, and the thing that stops four of
  //these reading as one long black bar
  fill(0, 0, 0, 110);
  rect(x, y, CODE_TILE_W, 2);

  if (character) {
    textFont('"Press Start 2P", monospace');
    textAlign(CENTER, CENTER);
    textSize(24);
    panelFill(PANEL_TEXT);
    text(character, x, y);
  }
  pop();
}

function drawRoomCodeTiles(code, centerX, centerY) {
  for (var i = 0; i < code.length; i++) {
    drawCodeTile(codeTileX(i, code.length, centerX), centerY, code.charAt(i), false);
  }
}

//an empty row with one tile lit, walking left to right - the code's own shape,
//visibly waiting to be filled in
function drawConnectingTiles(centerX, centerY) {
  var lit = Math.floor(millis() / CONNECT_TILE_STEP_MS) % 4;
  for (var i = 0; i < 4; i++) {
    drawCodeTile(codeTileX(i, 4, centerX), centerY, "", i === lit);
  }
}

function drawMultiplayerMenuScreen() {
  drawOverlayPanel();
  beginPanelText();
  panelFill(PANEL_TEXT);
  textSize(14);
  text("MULTIPLAYER", GAME_WIDTH / 2, 45);
  if (mpConnectionMessage) {
    textSize(8);
    panelFill(PANEL_BAD);
    text(mpConnectionMessage, GAME_WIDTH / 2, 66);
  } else {
    //without this the screen was two verbs and no explanation of which one
    //each player is meant to pick
    textSize(7);
    panelFill(PANEL_TEXT_DIM);
    text("ONE DEVICE CREATES A ROOM", GAME_WIDTH / 2, 60);
    text("THE OTHER JOINS WITH ITS CODE", GAME_WIDTH / 2, 72);
  }
  pop();

  drawButton(MULTIPLAYER_CREATE_BUTTON, "CREATE ROOM");
  drawButton(MULTIPLAYER_JOIN_BUTTON, "JOIN ROOM");
  drawButton(MENU_BACK_BUTTON, "BACK", BUTTON_SUBTLE);
}

function drawMultiplayerWaitingScreen() {
  drawOverlayPanel();
  beginPanelText();

  if (!mpRoomCode) {
    panelFill(PANEL_TEXT_DIM);
    textSize(8);
    text("CONNECTING" + waitingDots(), GAME_WIDTH / 2, 46);
    pop();
    //the empty code row, so the wait visibly belongs to the code that follows
    drawConnectingTiles(GAME_WIDTH / 2, 82);
    beginPanelText();
    var note = mpConnectingNote();
    if (note) {
      panelFill(PANEL_TEXT_DIM);
      textSize(7);
      text(note, GAME_WIDTH / 2, 120);
      text("THIS CAN TAKE UP TO A MINUTE", GAME_WIDTH / 2, 134);
    }
  } else if (mpJoining) {
    // The joiner shares this screen with the host while their socket
    // connects, but they are the one being waited FOR - the host is already
    // sitting in the room. Telling them they were waiting for an opponent,
    // with a COPY LINK button for someone else's room, was wrong on both
    // counts, and it hid the waking-server note a host would have been shown.
    panelFill(PANEL_TEXT_DIM);
    textSize(8);
    text("JOINING ROOM", GAME_WIDTH / 2, 46);
    pop();
    drawRoomCodeTiles(mpRoomCode, GAME_WIDTH / 2, 82);
    beginPanelText();
    panelFill(PANEL_TEXT_DIM);
    var joinNote = mpConnectingNote();
    if (joinNote) {
      textSize(7);
      text(joinNote, GAME_WIDTH / 2, 120);
      text("THIS CAN TAKE UP TO A MINUTE", GAME_WIDTH / 2, 134);
    } else {
      textSize(8);
      text("CONNECTING" + waitingDots(), GAME_WIDTH / 2, 120);
    }
  } else {
    panelFill(PANEL_TEXT_DIM);
    textSize(8);
    text("ROOM CODE", GAME_WIDTH / 2, 46);
    pop();
    //one tile per character - see drawRoomCodeTiles()
    drawRoomCodeTiles(mpRoomCode, GAME_WIDTH / 2, 82);
    beginPanelText();
    panelFill(PANEL_TEXT_DIM);
    textSize(8);
    text("WAITING FOR OPPONENT" + waitingDots(), GAME_WIDTH / 2, 120);

    var shareUrl = hostShareUrl();
    if (shareUrl) {
      if (millis() < shareCopiedUntilMillis) {
        panelFill(PANEL_GOOD);
        textSize(9);
        text("LINK COPIED", GAME_WIDTH / 2, 140);
      } else {
        panelFill(PANEL_TEXT_DIM);
        textSize(6);
        text(shareUrl, GAME_WIDTH / 2, 140);
      }
    }
  }
  pop();

  if (hostShareUrl()) {
    drawButton(WAITING_COPY_BUTTON, "COPY LINK", BUTTON_POSITIVE);
    drawButton(WAITING_LEAVE_BUTTON, "LEAVE", BUTTON_SUBTLE);
  } else {
    drawButton(MULTIPLAYER_LEAVE_BUTTON, "LEAVE", BUTTON_SUBTLE);
  }
}

// ---------------------------------------------------------------------------
// Race countdown
//
// Both players sit here for the same duration, measured on their own clock
// from when the server's "start" arrived, so they begin running together.
// ---------------------------------------------------------------------------

//which second was last beeped, so each tick sounds exactly once rather than
//once per frame
var countdownSecondBeeped = null;

// A waiting screen with nothing moving on it reads as frozen, and the first
// thing anyone wonders is whether it has hung. Cycling dots on a wall clock
// (not a frame counter) shows it is alive at the same rate on any display.
function waitingDots() {
  var count = Math.floor(millis() / 450) % 4;
  return "....".slice(0, count);
}

function playCountdownTick(isFinal) {
  if (isFinal) {
    playTone(880, 0.25, "square");
  } else {
    playTone(440, 0.12, "square");
  }
}

function drawMultiplayerCountdownScreen() {
  var remainingMs = mpRaceStartMillis - millis();
  var secondsLeft = Math.ceil(remainingMs / 1000);

  //beep once as each number appears, not once per frame
  if (countdownSecondBeeped !== secondsLeft) {
    countdownSecondBeeped = secondsLeft;
    playCountdownTick(false);
  }

  drawOverlayPanel();
  beginPanelText();
  panelFill(PANEL_TEXT_DIM);
  textSize(7);
  text("ROOM " + (mpRoomCode || "?") + "   -   SAME COURSE FOR BOTH", GAME_WIDTH / 2, 48);

  // The number swells as its second runs out, so the rhythm is visible and not
  // only audible - which matters on a muted phone, where the beeps are the
  // only other cue that the race is about to start.
  var intoSecond = 1 - ((remainingMs % 1000) / 1000);
  panelFill(PANEL_TEXT);
  textSize(40 + 10 * intoSecond);
  text(String(secondsLeft), GAME_WIDTH / 2, 100);
  pop();
}

// "GO!" belongs to the race, not the countdown. Drawn there it would have
// lasted exactly one frame - the same frame the start time passed, after
// which startRace() switches straight to PLAY - so nobody would ever have
// seen it. Flashing it over the opening moments of the run instead keeps the
// race beginning at precisely mpRaceStartMillis on both machines, which is
// the one thing that must not be nudged to make room for a bit of polish.
var MP_GO_FLASH_MS = 700;

function drawRaceGoFlash() {
  var elapsed = millis() - mpRaceStartMillis;
  if (elapsed < 0 || elapsed >= MP_GO_FLASH_MS) {
    return;
  }
  // Swells and fades rather than appearing and vanishing at full strength.
  // The fade is squared so it holds near-solid for the first half and then
  // clears quickly - the word has to be gone before the first cactus needs
  // looking at, but not so briefly that it reads as a flicker.
  var progress = elapsed / MP_GO_FLASH_MS;
  var alpha = 255 * (1 - progress * progress);

  push();
  textFont('"Press Start 2P", monospace');
  textAlign(CENTER, CENTER);
  textSize(30 + 16 * progress);
  fill(INK[0], INK[1], INK[2], alpha);
  text("GO!", GAME_WIDTH / 2 + 3, 62 + 3);
  fill(PANEL_GOOD[0], PANEL_GOOD[1], PANEL_GOOD[2], alpha);
  text("GO!", GAME_WIDTH / 2, 62);
  pop();
}

// ---------------------------------------------------------------------------
// Race result
//
// Reached the instant this player crashes, whether or not the opponent has.
// Until their final score arrives this is a waiting room showing your own.
// ---------------------------------------------------------------------------
function drawMultiplayerResultScreen() {
  drawOverlayPanel();
  beginPanelText();

  if (mpConnectionLost) {
    panelHeadline("CONNECTION LOST", 52, PANEL_BAD, 13);
    panelFill(PANEL_TEXT_DIM);
    textSize(7);
    text("THE RACE COULD NOT BE SCORED", GAME_WIDTH / 2, 78);
    panelFill(PANEL_TEXT);
    textSize(9);
    text("YOUR SCORE " + padScore(mpSelfScore), GAME_WIDTH / 2, 102);
  } else if (!mpOpponentFinished) {
    panelFill(PANEL_TEXT);
    textSize(12);
    text("YOU CRASHED", GAME_WIDTH / 2, 48);
    // Both scores, theirs still climbing in the ghost's blue, so watching them
    // run on is a race you can still follow rather than a wait.
    textSize(10);
    text("YOU  " + padScore(mpSelfScore), GAME_WIDTH / 2, 74);
    fill(GHOST_TINT[0], GHOST_TINT[1], GHOST_TINT[2]);
    text("THEM " + padScore(mpOpponentLiveScore === null ? 0 : mpOpponentLiveScore), GAME_WIDTH / 2, 94);
    panelFill(PANEL_TEXT_DIM);
    textSize(8);
    text("WAITING FOR OPPONENT" + waitingDots(), GAME_WIDTH / 2, 118);
  } else if (mpOpponentLeft) {
    panelHeadline("YOU WIN", 55, PANEL_GOOD, 16);
    panelFill(PANEL_TEXT_DIM);
    textSize(7);
    text("OPPONENT LEFT THE RACE", GAME_WIDTH / 2, 82);
    panelFill(PANEL_TEXT);
    textSize(9);
    text("SCORE " + padScore(mpSelfScore), GAME_WIDTH / 2, 106);
  } else {
    var won = mpSelfScore > mpOpponentScore;
    var tied = mpSelfScore === mpOpponentScore;
    if (tied) {
      panelHeadline("DEAD HEAT", 48, PANEL_TEXT, 17);
    } else if (won) {
      panelHeadline("YOU WIN", 48, PANEL_GOOD, 17);
    } else {
      panelHeadline("YOU LOSE", 48, PANEL_BAD, 17);
    }

    // The winning line is highlighted rather than both being the same colour,
    // so the result is readable at a glance instead of by comparing digits.
    textSize(10);
    panelFill(won || tied ? PANEL_TEXT : PANEL_TEXT_DIM);
    text("YOU  " + padScore(mpSelfScore), GAME_WIDTH / 2, 80);
    panelFill(!won || tied ? PANEL_TEXT : PANEL_TEXT_DIM);
    text("THEM " + padScore(mpOpponentScore), GAME_WIDTH / 2, 100);

    // The same gauge the race HUD ran on, frozen at the final margin. Two
    // five-digit numbers make you subtract to find out whether it was close;
    // the bar was already answering that question for the whole race, so it
    // answers it once more for the result.
    drawLeadGauge(GAME_WIDTH / 2, 122, RACE_HUD_GAUGE_W, RACE_HUD_GAUGE_H,
                  mpSelfScore - mpOpponentScore);
  }

  // Rematch status sits just above the buttons: whether you are waiting on
  // them, or they are waiting on you.
  if (canRematch()) {
    textSize(7);
    if (mpRematchRequested && !mpOpponentWantsRematch) {
      panelFill(PANEL_TEXT_DIM);
      text("WAITING FOR THEM TO ACCEPT" + waitingDots(), GAME_WIDTH / 2, 142);
    } else if (mpOpponentWantsRematch && !mpRematchRequested) {
      panelFill(PANEL_GOOD);
      text("OPPONENT WANTS A REMATCH", GAME_WIDTH / 2, 142);
    }
  } else if (!mpConnectionLost && mpOpponentFinished) {
    // The button is simply absent otherwise, which reads as the game having
    // forgotten the feature rather than as there being nobody left to play.
    panelFill(PANEL_TEXT_DIM);
    textSize(7);
    text("NO REMATCH - OPPONENT DISCONNECTED", GAME_WIDTH / 2, 142);
  }
  pop();

  if (canRematch() && !mpRematchRequested) {
    drawButton(RESULT_REMATCH_BUTTON, playerIsOnTouch ? "REMATCH" : "REMATCH (R)", BUTTON_POSITIVE);
    drawButton(RESULT_MENU_BUTTON, "MENU", BUTTON_SUBTLE);
  } else {
    //nobody to rematch, or already asked - one centered button reads better
    //than a live button sitting next to a dead one
    drawButton(MULTIPLAYER_LEAVE_BUTTON, "MENU", BUTTON_SUBTLE);
  }
}

// Both of these used to be drawn with whatever font and alignment happened to
// be left over from the last thing that drew - so they came out in p5's
// default sans-serif rather than the game's pixel font, and PAUSED was
// centred by subtracting a hardcoded 90px rather than by actually centring.
// ---------------------------------------------------------------------------
// Controls hint
//
// Nothing in the game ever said how to play it, which matters most for exactly
// the player who arrives from a shared link with no idea what this is.
//
// It clears itself the moment you jump rather than after a fixed delay: a
// player who already knows the controls never sees it for more than an
// instant, and one who doesn't keeps it until they have actually used it. The
// timeout is only a backstop so it cannot sit there forever.
// ---------------------------------------------------------------------------
var CONTROLS_HINT_MS = 6000;
var CONTROLS_HINT_FADE_MS = 600;
//once per page load, not once per run - relearning is not a thing
var playerHasJumped = false;
var runStartedMillis = 0;

function controlsHintAlpha() {
  if (playerHasJumped) {
    return 0;
  }
  var elapsed = millis() - runStartedMillis;
  if (elapsed >= CONTROLS_HINT_MS) {
    return 0;
  }
  var remaining = CONTROLS_HINT_MS - elapsed;
  return remaining < CONTROLS_HINT_FADE_MS ? remaining / CONTROLS_HINT_FADE_MS : 1;
}

function drawControlsHint() {
  var alpha = controlsHintAlpha();
  if (alpha <= 0) {
    return;
  }

  drawInkCard(GAME_WIDTH / 2, 44, 330, 44, alpha);

  push();
  noStroke();
  textFont('"Press Start 2P", monospace');
  textAlign(CENTER, CENTER);
  textSize(7);
  // Both control schemes are named rather than guessing from the device: a
  // touchscreen laptop is both, and guessing wrong leaves the player reading
  // instructions for hardware they do not have.
  fill(PANEL_TEXT[0], PANEL_TEXT[1], PANEL_TEXT[2], 255 * alpha);
  text("SPACE / TAP TOP  -  JUMP  (HOLD TO GO HIGHER)", GAME_WIDTH / 2, 35);
  fill(PANEL_TEXT_DIM[0], PANEL_TEXT_DIM[1], PANEL_TEXT_DIM[2], 255 * alpha);
  text("DOWN / HOLD BOTTOM  -  DUCK", GAME_WIDTH / 2, 53);
  pop();
}

function drawPausedOverlay() {
  push();
  rectMode(CENTER);
  noStroke();
  // Dims the frozen world so the overlay is clearly a state, not a glitch.
  // The whole canvas, not just the 600x200 strip: this is drawn in strip
  // coordinates, and dimming only the strip left the extra sky above it and
  // the sand below it lit, framing the paused game in a dark band.
  fill(0, 0, 0, 120);
  rect(width / 2, height / 2 - viewOffsetY, width, height);
  pop();

  drawInkCard(GAME_WIDTH / 2, 100, 260, 74);

  push();
  noStroke();
  textFont('"Press Start 2P", monospace');
  textAlign(CENTER, CENTER);
  panelFill(PANEL_TEXT);
  textSize(16);
  text("PAUSED", GAME_WIDTH / 2, 86);
  panelFill(PANEL_TEXT_DIM);
  textSize(7);
  //the play button in the corner is the only way back for a phone player
  text(playerIsOnTouch ? "TAP THE PLAY BUTTON TO RESUME" : "PRESS P TO RESUME", GAME_WIDTH / 2, 114);
  pop();
}

function drawMultiplayerJoinEntryScreen() {
  drawOverlayPanel();
  beginPanelText();
  panelFill(PANEL_TEXT);
  textSize(12);
  text("JOIN ROOM", GAME_WIDTH / 2, 45);
  panelFill(PANEL_TEXT_DIM);
  textSize(7);
  text("ENTER THE 4-CHARACTER CODE", GAME_WIDTH / 2, 66);
  pop();
  //the actual code entry box is the real HTML <input> positioned over the
  //canvas here - see positionRoomCodeInput()

  drawButton(MULTIPLAYER_JOIN_SUBMIT_BUTTON, "JOIN");
  drawButton(MENU_BACK_BUTTON, "BACK", BUTTON_SUBTLE);
}

var GAME_WIDTH = 600;
var GAME_HEIGHT = 200;

//distance from the true top-right corner of the canvas to the score text
var SCORE_MARGIN = 18;

// Gameplay happens in a fixed 600x200 strip, but real screens are nowhere
// near 3:1, so scaling just that strip to fit left big blank bars above and
// below it. Instead the canvas is made as tall as the screen's shape needs -
// still 600 wide, so every spawn/collision/physics number is untouched - and
// the extra height becomes more sky above and more sand below. viewOffsetY is
// where the 600x200 strip sits inside that taller canvas.
var SKY_SHARE_OF_EXTRA_HEIGHT = 0.6;
var viewOffsetY = 0;

// The viewport, measured rather than remembered.
//
// p5 caches windowWidth/windowHeight and only refreshes them from inside its
// own resize handler, so both are exactly as stale as the resize event is -
// and that event is not dependable in the places this game runs. Entering or
// leaving fullscreen, rotating a phone, and a mobile URL bar hiding itself all
// change the viewport, and browsers variously coalesce, delay, or skip the
// resize that should announce it. Reading the live values instead means a
// missed event costs nothing: the next frame measures the real viewport and
// lays the canvas out for it.
//the <html> box is the fallback because a few mobile browsers report 0 for
//window.inner* during an orientation change, mid-rotation
var docRoot = document.documentElement || null;

function viewportWidth() {
  return window.innerWidth || (docRoot && docRoot.clientWidth) || windowWidth;
}

function viewportHeight() {
  return window.innerHeight || (docRoot && docRoot.clientHeight) || windowHeight;
}

// What fillScreen() last laid the canvas out for, so an unchanged viewport can
// skip both the style writes and the layout they would force - see
// syncScreenLayout().
var appliedLayout = { width: 0, height: 0, ratio: 0 };

function deviceRatio() {
  return window.devicePixelRatio || 1;
}

// ---------------------------------------------------------------------------
// Drawing resolution
//
// The canvas is always 600 game units wide and is stretched by CSS to fill the
// screen, but p5 sizes its drawing buffer from devicePixelRatio alone - which
// knows nothing about that stretch. On an ordinary 1080p monitor the ratio is
// 1, so the whole game was drawn into a 600x338 buffer and the browser blew it
// up 3.2x: every letter, button edge and sprite came out as a soft blur, on
// exactly the screen most people will first see it on. Phones had the reverse
// problem: a ratio of 3 made a 1800-pixel-wide buffer that was then shrunk to
// fit a screen 1170 pixels across, drawing half again as many pixels as the
// screen could show, every frame.
//
// So the buffer is sized to the pixels the canvas really covers on screen:
// its CSS width times devicePixelRatio. Nothing in the game's own coordinates
// changes - p5 scales the drawing context by the density - so physics, hit
// boxes and the course are untouched; there are simply as many pixels behind
// each game unit as the screen can show.
// ---------------------------------------------------------------------------
//a buffer this wide is already sharp on any screen a browser window reaches,
//and keeps a 4K display from quadrupling the fill work of every frame
var MAX_DRAWING_BUFFER_WIDTH = 2560;

function displayPixelDensity(cssWidth) {
  var bufferWidth = Math.round(cssWidth * deviceRatio());
  // Never below one buffer pixel per game unit: a window that small is shown
  // shrunk anyway, and drawing fewer pixels than the game's own units would
  // only make the sprites' edges worse on the way down.
  bufferWidth = Math.max(GAME_WIDTH, Math.min(MAX_DRAWING_BUFFER_WIDTH, bufferWidth));
  return bufferWidth / GAME_WIDTH;
}

function fillScreen() {
  var screenWidth = viewportWidth();
  var screenHeight = viewportHeight();
  var viewHeight = Math.max(GAME_HEIGHT, Math.round(GAME_WIDTH * screenHeight / screenWidth));
  if (width !== GAME_WIDTH || height !== viewHeight) {
    //noRedraw: this also runs from setup(), before the sprites draw() needs exist
    resizeCanvas(GAME_WIDTH, viewHeight, true);
  }
  viewOffsetY = Math.round((height - GAME_HEIGHT) * SKY_SHARE_OF_EXTRA_HEIGHT);

  //only a window wider than 3:1 still gets bars (at the sides)
  var scaleFactor = Math.min(screenWidth / width, screenHeight / height);
  var cssWidth = width * scaleFactor;
  var cssHeight = height * scaleFactor;
  //rounding viewHeight can leave the fit a pixel or two short; stretch that
  //sliver rather than show a hairline of page background along one edge
  if (Math.abs(cssWidth - screenWidth) <= scaleFactor + 1) {
    cssWidth = screenWidth;
  }
  if (Math.abs(cssHeight - screenHeight) <= scaleFactor + 1) {
    cssHeight = screenHeight;
  }
  // Before the style writes below, because p5 resizes the canvas to change its
  // density and resets the element's CSS size to the game's own while doing it.
  if (typeof pixelDensity === "function") {
    var density = displayPixelDensity(cssWidth);
    if (Math.abs(pixelDensity() - density) > 0.001) {
      pixelDensity(density);
    }
  }
  var canvasElt = canvasElement();
  if (canvasElt) {
    canvasElt.style.width = cssWidth + "px";
    canvasElt.style.height = cssHeight + "px";
  }
  //what a CSS pixel is worth in game units, which is what decides how far a
  //hit box has to grow to be reliably tappable - see MIN_TOUCH_TARGET_CSS_PX
  unitsPerCssPixel = cssWidth > 0 ? width / cssWidth : 1;
  appliedLayout.width = screenWidth;
  appliedLayout.height = screenHeight;
  appliedLayout.ratio = deviceRatio();
}

// Called at the top of every frame, so the canvas is always laid out for the
// viewport that exists right now rather than for the last one the browser
// bothered to announce. A canvas sized for a viewport that is gone is exactly
// the state where the strip the player is looking at and the strip the hit
// tests are measured against stop being the same strip.
//
// Cheap in the normal case: it reads three numbers off window and returns, so
// nothing is written and no relayout happens unless the viewport really moved.
// The pixel ratio is one of them because dragging the window onto a monitor
// with a different one changes how many pixels the canvas covers without
// changing its size at all.
function syncScreenLayout() {
  if (viewportWidth() === appliedLayout.width &&
      viewportHeight() === appliedLayout.height &&
      deviceRatio() === appliedLayout.ratio) {
    return;
  }
  fillScreen();
  if (roomCodeInputElt && roomCodeInputElt.style.display !== "none") {
    positionRoomCodeInput();
  }
}

function windowResized() {
  fillScreen();
  if (roomCodeInputElt && roomCodeInputElt.style.display !== "none") {
    positionRoomCodeInput();
  }
}

// ---------------------------------------------------------------------------
// Room code input - a real HTML <input> overlaid on the canvas rather than a
// canvas-drawn text field, so typing a room code on a phone actually pops up
// the device's own keyboard (a canvas-drawn "text field" never focuses
// anything, so touch users would otherwise have no way to type at all).
// ---------------------------------------------------------------------------
var roomCodeInputElt = null;

//below this, iOS zooms the page on focus - see positionRoomCodeInput()
var MIN_INPUT_FONT_PX = 16;

function createRoomCodeInput() {
  roomCodeInputElt = document.createElement("input");
  roomCodeInputElt.type = "text";
  roomCodeInputElt.maxLength = 4;
  roomCodeInputElt.autocomplete = "off";
  roomCodeInputElt.autocapitalize = "characters";
  roomCodeInputElt.spellcheck = false;
  roomCodeInputElt.style.position = "absolute";
  roomCodeInputElt.style.display = "none";
  roomCodeInputElt.style.textAlign = "center";
  roomCodeInputElt.style.fontFamily = '"Press Start 2P", monospace';
  roomCodeInputElt.style.boxSizing = "border-box";
  roomCodeInputElt.style.textTransform = "uppercase";
  // Themed to match the tile row the waiting screen shows the code on, so the
  // field you type a code into and the tiles you read one off are visibly the
  // same slot. Square-cornered for the same reason nothing else here is
  // rounded - a radius is what makes it look like a browser control pasted
  // over the game.
  roomCodeInputElt.style.background = "#0e0c0b";
  roomCodeInputElt.style.color = "#f7f1e2";
  roomCodeInputElt.style.caretColor = "#f49e3e";
  roomCodeInputElt.style.border = "3px solid #1a1614";
  roomCodeInputElt.style.borderRadius = "0";
  roomCodeInputElt.style.outline = "none";

  //a visible focus ring, since the field is the only thing to do on that screen
  roomCodeInputElt.addEventListener("focus", function () {
    roomCodeInputElt.style.border = "3px solid #f49e3e";
  });
  roomCodeInputElt.addEventListener("blur", function () {
    roomCodeInputElt.style.border = "3px solid #1a1614";
  });

  //only letters/digits, uppercased, capped at 4 chars - matches the room
  //codes the server actually generates (see ROOM_CODE_CHARS in server.js)
  roomCodeInputElt.addEventListener("input", function () {
    roomCodeInputElt.value = roomCodeInputElt.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 4);
  });
  roomCodeInputElt.addEventListener("keydown", function (e) {
    if (e.key === "Enter") {
      multiplayerJoinSubmitRequested = true;
    }
  });

  document.body.appendChild(roomCodeInputElt);
}

function positionRoomCodeInput() {
  var canvasElt = canvasElement();
  if (!canvasElt || !roomCodeInputElt) {
    return;
  }
  var rect = canvasElt.getBoundingClientRect();
  var scaleX = rect.width / width;
  var scaleY = rect.height / height;
  //centered at game-space (300, 95), matching where the join-entry screen
  //draws its heading around
  var gx = 300, gy = 95, gw = 180, gh = 34;

  // iOS Safari zooms the entire page in when you focus an input whose text is
  // smaller than 16px - and it ignores user-scalable=no while doing it, so the
  // meta viewport tag does not prevent this. The canvas is letterboxed to the
  // screen, so the zoom leaves the game half off-screen with no way to scroll
  // back, on the one screen a phone player has no way to avoid. A phone-shaped
  // window scales this field to about 12px, so the floor is what matters here.
  var fontPx = Math.max(MIN_INPUT_FONT_PX, Math.round(18 * scaleY));
  //the box grows with the text rather than clipping it
  var boxWidth = Math.max(gw * scaleX, fontPx * 8);
  var boxHeight = Math.max(gh * scaleY, fontPx + 12);
  var letterSpacingPx = Math.round(fontPx * 0.35);

  roomCodeInputElt.style.left = (rect.left + gx * scaleX - boxWidth / 2) + "px";
  roomCodeInputElt.style.top = (rect.top + (gy + viewOffsetY) * scaleY - boxHeight / 2) + "px";
  roomCodeInputElt.style.width = boxWidth + "px";
  roomCodeInputElt.style.height = boxHeight + "px";
  roomCodeInputElt.style.fontSize = fontPx + "px";
  // Letter-spacing adds its gap AFTER the last character too, and that
  // trailing gap is part of what gets centered - so the four visible
  // characters sat half a gap left of centre. The indent puts them back.
  roomCodeInputElt.style.letterSpacing = letterSpacingPx + "px";
  roomCodeInputElt.style.textIndent = Math.round(letterSpacingPx / 2) + "px";
}

// Safe to call twice for one tap - see the JOIN branch of
// onCanvasPointerDown() - so it only clears the field when it was actually
// hidden, rather than wiping whatever has been typed.
function showRoomCodeInput() {
  if (!roomCodeInputElt) {
    return;
  }
  if (roomCodeInputElt.style.display === "none") {
    roomCodeInputElt.value = "";
  }
  roomCodeInputElt.style.display = "block";
  positionRoomCodeInput();
  roomCodeInputElt.focus();
}

function hideRoomCodeInput() {
  if (!roomCodeInputElt) {
    return;
  }
  roomCodeInputElt.style.display = "none";
  roomCodeInputElt.blur();
}

// Browsers only allow real fullscreen (hiding tabs and the address bar) to
// start from inside a genuine input event - never on page load - so it's
// requested on the player's first key press or tap. After that F toggles it,
// and Esc leaves it as on any page. Entering/leaving fires a window resize,
// which windowResized() above already handles.
function isFullscreen() {
  return !!(document.fullscreenElement || document.webkitFullscreenElement);
}

function enterFullscreen() {
  var el = document.documentElement;
  var request = el.requestFullscreen || el.webkitRequestFullscreen;
  if (!request || isFullscreen()) {
    return;
  }
  var result = request.call(el);
  //refused (e.g. inside an iframe without permission) - just stay windowed
  if (result && result.catch) {
    result.catch(function() {});
  }
}

function exitFullscreen() {
  var exit = document.exitFullscreen || document.webkitExitFullscreen;
  if (!exit || !isFullscreen()) {
    return;
  }
  var result = exit.call(document);
  if (result && result.catch) {
    result.catch(function() {});
  }
}

var fullscreenAutoTried = false;

function tryAutoFullscreen() {
  if (fullscreenAutoTried) {
    return;
  }
  fullscreenAutoTried = true;
  enterFullscreen();
}

function onKeyDownForFullscreen(e) {
  // Typing a room code focuses a real <input> (see createRoomCodeInput()),
  // and the room codes the server generates can contain "F" - without this
  // guard, typing one mid-code would also toggle fullscreen out from under
  // the player.
  if (e.target && (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA")) {
    return;
  }
  if (e.key === "f" || e.key === "F") {
    if (!e.repeat) {
      fullscreenAutoTried = true;
      if (isFullscreen()) {
        exitFullscreen();
      } else {
        enterFullscreen();
      }
    }
    return;
  }
  //Esc is how you get out of fullscreen, so it must never be what enters it
  if (e.key !== "Escape") {
    tryAutoFullscreen();
  }
}

document.addEventListener("keydown", onKeyDownForFullscreen);
document.addEventListener("pointerdown", tryAutoFullscreen);

function preload(){
  trex_running =   loadAnimation("trex1.png","trex3.png","trex4.png");
  trex_collided = loadAnimation("trex_collided.png");

  // The opponent ghost is drawn by hand rather than as a second sprite, so it
  // needs the frames as plain images. Sharing trex_running with a second
  // p5.play sprite would couple the two dinos' animation state, and reading
  // frames off the local trex would break the moment the player dies and
  // their sprite switches to the collided animation - the opponent may well
  // still be running at that point.
  ghostRunFrames = [loadImage("trex1.png"), loadImage("trex3.png"), loadImage("trex4.png")];
  ghostCollidedImage = loadImage("trex_collided.png");

  groundImage = loadImage("ground2.png");

  cloudImage = loadImage("cloud.png");

  obstacle1 = loadImage("obstacle1.png");
  obstacle2 = loadImage("obstacle2.png");
  obstacle3 = loadImage("obstacle3.png");
  obstacle4 = loadImage("obstacle4.png");
  obstacle5 = loadImage("obstacle5.png");
  obstacle6 = loadImage("obstacle6.png");

  gameOverImg = loadImage("gameOver.png");
  restartImg = loadImage("restart.png");
}

function setup() {
  createCanvas(GAME_WIDTH, GAME_HEIGHT);
  fillScreen();

  //pointerdown covers both mouse clicks and touch taps
  var canvasElt = canvasElement();
  if (canvasElt) {
    canvasElt.addEventListener("pointerdown", onCanvasPointerDown);
    canvasElt.addEventListener("pointermove", onCanvasPointerMove);
    canvasElt.addEventListener("pointerleave", onCanvasPointerLeave);
    //released anywhere, not just over the button, so a press can't get stuck
    //held after the pointer wanders off and lets go somewhere else
    window.addEventListener("pointerup", onPointerRelease);
    window.addEventListener("pointercancel", onPointerRelease);
  }

  createRoomCodeInput();

  // Let draw() run as fast as the browser will grant (matches the
  // monitor's native refresh rate - 60/144/240Hz - instead of a fixed cap).
  frameRate(1000);

  trex = createSprite(50,180,20,50);

  trex.addAnimation("running", trex_running);
  trex.addAnimation("collided", trex_collided);
  trex.scale = 0.5;

  ground = createSprite(200,180,400,20);
  ground.addImage("ground",groundImage);
  ground.x = ground.width /2;
  // Not set moving here: the game now starts on the MENU screen rather than
  // PLAY, and the wrap-around check that keeps the ground looping only runs
  // inside the PLAY branch of draw() - a non-zero velocity here would have
  // scrolled it off to the left forever before a game even started. PLAY
  // sets its own velocity from currentSpeed() every frame once gameplay
  // actually begins.
  ground.velocityX = 0;

  gameOver = createSprite(300,100);
  gameOver.addImage(gameOverImg);

  restart = createSprite(300,140);
  restart.addImage(restartImg);

  gameOver.scale = 0.5;
  restart.scale = 0.5;

  gameOver.visible = false;
  restart.visible = false;

  invisibleGround = createSprite(200,190,400,10);
  invisibleGround.visible = false;

  cloudsGroup = new Group();
  obstaclesGroup = new Group();

  crowFrame1 = buildCrowFrame(true);
  crowFrame2 = buildCrowFrame(false);
  boulderImage = buildBoulderImage();

  score = 0;
  trexVY = 0;
  lastFrameMillis = millis();
  distanceTravelled = 0;
  lastObstacleSpawnDistance = 0;
  lastCloudSpawnDistance = 0;
  lastObstacleWidth = 0;
  //must precede the gap roll below - that roll comes out of this stream
  seedObstacleStream(nextRunSeed());
  nextObstacleGap = rollObstacleGap(obstacleRandom());
  nextCloudGap = rollCloudGap();
  nextScoreMilestone = SCORE_MILESTONE_INTERVAL;

  // Arriving on a shared ?room= link goes straight into that room rather than
  // dropping the player on the menu to type in a code they were sent
  // precisely so they wouldn't have to.
  var invitedRoom = readRoomFromUrl();
  if (invitedRoom) {
    mpJoinRoom(invitedRoom);
    gameState = MULTIPLAYER_WAITING;
    clearRoomFromUrl();
  }
}

// ---------------------------------------------------------------------------
// Sound effects
//
// The project ships no audio assets, so these are synthesized with the Web
// Audio API instead of loaded from files. Browsers refuse to let audio play
// until a real user gesture has happened, so the AudioContext is created
// lazily on first use (from inside playTone(), called from a jump/score/death
// that only ever happens as a result of a keypress or tap) rather than in
// setup(), where it would stay permanently suspended.
// ---------------------------------------------------------------------------
var audioCtx = null;

function getAudioContext() {
  var AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) {
    return null;
  }
  if (!audioCtx) {
    audioCtx = new AudioContextClass();
  }
  if (audioCtx.state === "suspended") {
    audioCtx.resume();
  }
  return audioCtx;
}

// Sound has no opt-out otherwise, and it plays automatically the moment
// someone jumps - "M" toggles it, remembered across sessions the same way
// as the high score (and guarded against localStorage throwing for the
// same reason: see readHighScore()/saveHighScore()).
function readMuted() {
  try {
    return localStorage["SoundMuted"] === "true";
  } catch (e) {
    return false;
  }
}

function saveMuted(value) {
  try {
    localStorage["SoundMuted"] = value ? "true" : "false";
  } catch (e) {
    //storage unavailable - mute preference just won't survive a reload
  }
}

var soundMuted = readMuted();
var muteKeyWasDown = false;

//toggle on a fresh press of M, not every frame it's held
function handleMuteToggle() {
  // A tap on the button is unambiguous in a way the M key is not - it cannot
  // be someone typing a room code - so it skips the guard below entirely.
  if (muteRequested) {
    muteRequested = false;
    soundMuted = !soundMuted;
    saveMuted(soundMuted);
    return;
  }
  // Unlike handlePauseToggle() below, this has no gameState gate, so without
  // this check typing "M" as part of a room code (a valid character - see
  // ROOM_CODE_CHARS in server.js) would also toggle mute, since p5's own key
  // tracking doesn't know or care whether a text <input> has focus.
  if (roomCodeInputElt && document.activeElement === roomCodeInputElt) {
    return;
  }
  var muteKeyIsDown = keyHeld("m");
  if (muteKeyIsDown && !muteKeyWasDown) {
    soundMuted = !soundMuted;
    saveMuted(soundMuted);
  }
  muteKeyWasDown = muteKeyIsDown;
}

// "P" pauses/resumes - only meaningful while actually playing (or already
// paused); pressing it on the game-over screen does nothing, same as other
// gameplay keys there. Zeroing the sprites' velocities (not trexVY, our own
// gravity accumulator) is what actually freezes them: drawSprites() applies
// whatever velocity a sprite is still carrying every call regardless of
// gameState, which is why the END branch below does the same thing - leaving
// trexVY untouched instead lets a mid-jump pause resume its arc exactly
// where it left off instead of snapping.
var pauseKeyWasDown = false;

function handlePauseToggle() {
  var pauseKeyIsDown = keyHeld("p");
  var pressed = (pauseKeyIsDown && !pauseKeyWasDown) || pauseRequested;
  pauseRequested = false;
  // Pausing a race would be a free timeout - the opponent's run keeps going
  // on their own machine regardless, so this would only ever hand the pauser
  // thinking time they haven't earned.
  if (pressed && !mpIsRacing) {
    if (gameState === PLAY) {
      gameState = PAUSED;
      ground.velocityX = 0;
      trex.velocityY = 0;
      obstaclesGroup.setVelocityXEach(0);
      cloudsGroup.setVelocityXEach(0);
    } else if (gameState === PAUSED) {
      gameState = PLAY;
    }
  }
  pauseKeyWasDown = pauseKeyIsDown;
}

function playTone(frequency, durationSeconds, type, delaySeconds) {
  if (soundMuted) {
    return;
  }
  var ctx = getAudioContext();
  if (!ctx) {
    return;
  }
  var oscillator = ctx.createOscillator();
  var gain = ctx.createGain();
  oscillator.type = type || "square";
  oscillator.frequency.value = frequency;
  //scheduled on the audio clock rather than with setTimeout, so multi-note
  //sounds stay tightly timed even when the page is busy
  var startAt = ctx.currentTime + (delaySeconds || 0);
  //quick fade-out instead of a hard stop, so each blip doesn't click
  gain.gain.setValueAtTime(0.08, startAt);
  gain.gain.exponentialRampToValueAtTime(0.0001, startAt + durationSeconds);
  oscillator.connect(gain);
  gain.connect(ctx.destination);
  oscillator.start(startAt);
  oscillator.stop(startAt + durationSeconds);
}

// iOS Safari only actually starts an AudioContext when resume() is called
// synchronously inside a real user-gesture event handler (keydown,
// touchstart, click) - not from a later requestAnimationFrame callback, even
// one triggered by that same gesture. playJumpSound() etc. call
// getAudioContext() from inside draw()'s frame loop, which is too late for
// Safari, so also unlock it directly from the very first real input event.
function unlockAudioContext() {
  getAudioContext();
}
document.addEventListener("keydown", unlockAudioContext, { once: true });
document.addEventListener("touchstart", unlockAudioContext, { once: true });
document.addEventListener("mousedown", unlockAudioContext, { once: true });

function playJumpSound() {
  playTone(520, 0.09);
}

// Score climbs ~30 points a second, so this fires every ~3 seconds no matter
// what the trex is doing - often mid-descent. As a single square blip like
// the jump sound, it read as a mistimed "landing" sound. A rising two-note
// triangle chime is unmistakably its own thing.
function playScoreMilestoneSound() {
  playTone(784, 0.08, "triangle");
  playTone(1175, 0.14, "triangle", 0.08);
}

function playDeathSound() {
  playTone(160, 0.35, "sawtooth");
}

// ---------------------------------------------------------------------------
// Death impact feedback: a brief screen shake and red flash, for a bit of
// arcade-style punch on collision instead of the game just silently freezing.
// ---------------------------------------------------------------------------
var DEATH_SHAKE_DURATION_MS = 250;
var DEATH_SHAKE_MAX_PX = 6;
var DEATH_FLASH_DURATION_MS = 200;
//negative = no death has happened yet (or a new run has started) since this run
var deathEffectStartMillis = -1;

function deathEffectElapsedMs() {
  if (deathEffectStartMillis < 0) {
    return Infinity;
  }
  return millis() - deathEffectStartMillis;
}

//decays to (0,0) once DEATH_SHAKE_DURATION_MS has passed, so the shake settles
//instead of jittering the game-over screen forever
function currentShakeOffset() {
  var elapsed = deathEffectElapsedMs();
  if (elapsed >= DEATH_SHAKE_DURATION_MS) {
    return { x: 0, y: 0 };
  }
  var magnitude = DEATH_SHAKE_MAX_PX * (1 - elapsed / DEATH_SHAKE_DURATION_MS);
  return { x: random(-magnitude, magnitude), y: random(-magnitude, magnitude) };
}

//drawn in full-canvas space (after the gameplay strip's own push/pop), so the
//flash covers the whole screen regardless of where the strip sits inside it
function drawDeathFlash() {
  var elapsed = deathEffectElapsedMs();
  if (elapsed >= DEATH_FLASH_DURATION_MS) {
    return;
  }
  var alpha = 120 * (1 - elapsed / DEATH_FLASH_DURATION_MS);
  noStroke();
  fill(200, 30, 30, alpha);
  rect(0, 0, width, height);
}

//two harsh, quick blips read as a "caw" - distinct from the jump/score/death
//tones so a crow entering the screen is heard, not just seen
function playCrowSound() {
  playTone(300, 0.05, "sawtooth");
  playTone(220, 0.07, "sawtooth", 0.06);
}

// Chrome's dino flips to a dark palette for a stretch every so many points,
// then back to day, alternating for as long as you survive. Matches Chrome's
// own 700-point interval.
var NIGHT_MODE_SCORE_INTERVAL = 700;

// Matches Chrome's dino: a short beep every 100 points.
var SCORE_MILESTONE_INTERVAL = 100;
var nextScoreMilestone = SCORE_MILESTONE_INTERVAL;

//every hundred already plays a blip; this is the same event made visible, so
//the milestone lands for a player with the sound off too
var SCORE_FLASH_MS = 420;
var scoreFlashStartMillis = -1;

function scoreFlashStrength() {
  if (scoreFlashStartMillis < 0) {
    return 0;
  }
  var elapsed = millis() - scoreFlashStartMillis;
  return elapsed >= SCORE_FLASH_MS ? 0 : 1 - elapsed / SCORE_FLASH_MS;
}

// ---------------------------------------------------------------------------
// Score HUD
//
// Every character in "Press Start 2P" advances exactly one em, so a string's
// width is its length times the text size - no textWidth() call needed to
// size the plate it sits on. Monospace was already load-bearing here for a
// different reason: with a proportional font the right-aligned score visibly
// shifted left and right every time a digit changed.
// ---------------------------------------------------------------------------
var HUD_HI_SIZE = 8;
var HUD_SCORE_SIZE = 16;
var HUD_PAD_X = 12;
var HUD_PAD_Y = 8;

function pixelTextWidth(str, size) {
  return str.length * size;
}

//the live score only means anything once a run has started, and on the menu
//and in the lobby it is always five zeros - a number with nothing behind it
function hudShowsLiveScore() {
  return gameState === PLAY || gameState === END || gameState === PAUSED;
}

// Drawn on the same ink plate as every other card rather than as bare text
// recoloured between black and white at the day/night midpoint. The plate is
// what lets the digits keep one colour: they no longer have to survive both a
// pale blue sky and a near-black one.
//
// Pinned to the real screen corner, not to the 600x200 strip, so it stays in
// the top-right border regardless of how much extra sky the screen's shape
// adds above the strip.
function drawScoreHud() {
  var showLive = hudShowsLiveScore();
  var beatenBest = runStartHighScore > 0 && Math.floor(score) > runStartHighScore;
  var topLine = beatenBest ? "NEW BEST" : "HI " + padScore(highScore);
  var scoreLine = padScore(score);

  var contentWidth = Math.max(
    pixelTextWidth(topLine, HUD_HI_SIZE),
    showLive ? pixelTextWidth(scoreLine, HUD_SCORE_SIZE) : 0);
  var contentHeight = showLive ? HUD_HI_SIZE + HUD_SCORE_SIZE + 6 : HUD_HI_SIZE;
  var plateWidth = contentWidth + HUD_PAD_X * 2;
  var plateHeight = contentHeight + HUD_PAD_Y * 2;
  var right = width - SCORE_MARGIN;
  var centerX = right - plateWidth / 2;
  var top = SCORE_MARGIN;

  drawInkCard(centerX, top + plateHeight / 2, plateWidth, plateHeight, 0.9);

  push();
  noStroke();
  textFont('"Press Start 2P", monospace');
  textAlign(RIGHT, TOP);
  var textRight = right - HUD_PAD_X;

  textSize(HUD_HI_SIZE);
  if (beatenBest) {
    fill(BUTTON_PRIMARY.hover[0], BUTTON_PRIMARY.hover[1], BUTTON_PRIMARY.hover[2], menuBlinkAlpha());
  } else {
    panelFill(PANEL_TEXT_DIM);
  }
  text(topLine, textRight, top + HUD_PAD_Y);

  if (showLive) {
    textSize(HUD_SCORE_SIZE);
    // A milestone tints the digits towards the marquee amber and fades back
    // over SCORE_FLASH_MS, so passing a hundred is something you see and not
    // only something you hear.
    var flash = scoreFlashStrength();
    fill(
      PANEL_TEXT[0] + (BUTTON_PRIMARY.hover[0] - PANEL_TEXT[0]) * flash,
      PANEL_TEXT[1] + (BUTTON_PRIMARY.hover[1] - PANEL_TEXT[1]) * flash,
      PANEL_TEXT[2] + (BUTTON_PRIMARY.hover[2] - PANEL_TEXT[2]) * flash);
    text(scoreLine, textRight, top + HUD_PAD_Y + HUD_HI_SIZE + 6);
  }
  pop();
}

function isNightMode() {
  return Math.floor(score / NIGHT_MODE_SCORE_INTERVAL) % 2 === 1;
}

// 0 = full day, 1 = full night. Eases toward whatever isNightMode() says over
// DAY_NIGHT_TRANSITION_MS of real time instead of snapping, and only advances
// while playing, so pausing or dying freezes a fade part-way through.
var DAY_NIGHT_TRANSITION_MS = 1000;
var nightAmount = 0;

var DAY_SKY = [135, 206, 235];
var NIGHT_SKY = [20, 24, 46];
var DAY_SAND = [222, 184, 135];
var NIGHT_SAND = [60, 56, 48];

function blendRgb(dayRgb, nightRgb, t) {
  return [
    dayRgb[0] + (nightRgb[0] - dayRgb[0]) * t,
    dayRgb[1] + (nightRgb[1] - dayRgb[1]) * t,
    dayRgb[2] + (nightRgb[2] - dayRgb[2]) * t
  ];
}

// Star positions are rolled once so they stay put instead of flickering to
// new spots every frame. Math.random() rather than p5's random(): this runs
// at load time, before p5 has installed its global functions. Stored as 0-1
// fractions because how much sky there is depends on the screen's shape.
var STAR_COUNT = 70;
var stars = (function() {
  var list = [];
  for (var i = 0; i < STAR_COUNT; i++) {
    list.push({
      x: Math.random(),
      y: Math.random(),
      size: Math.random() < 0.25 ? 2 : 1,
      //each star twinkles on its own cycle so the whole sky doesn't pulse in unison
      twinklePhase: Math.random() * Math.PI * 2,
      twinkleSpeed: 0.4 + Math.random() * 0.6
    });
  }
  return list;
})();

//where a star lands on the canvas: anywhere in the visible sky, from the top
//of the screen down to just above the ground line
function starCanvasPosition(star) {
  var skyTop = 4;
  var skyBottom = viewOffsetY + 165;
  return {
    x: Math.floor(star.x * GAME_WIDTH),
    y: Math.floor(skyTop + star.y * (skyBottom - skyTop))
  };
}

// Fraction of screen width a star drifts left per 60fps reference frame - a
// full pass across the sky takes a couple of minutes, subtle enough to read
// as "the sky is alive" without looking like the stars are racing the ground.
var STAR_DRIFT_SPEED = 0.0003;

function updateStars(dtFactor) {
  for (var i = 0; i < stars.length; i++) {
    var star = stars[i];
    star.x -= STAR_DRIFT_SPEED * dtFactor;
    if (star.x < 0) {
      star.x += 1;
    }
  }
}

function drawStars(alpha) {
  if (alpha <= 0) {
    return;
  }
  var nowSeconds = millis() / 1000;
  for (var i = 0; i < stars.length; i++) {
    var star = stars[i];
    //brightness oscillates between 55% and 100% of the base alpha, per-star
    //phase/speed so the sky twinkles instead of the whole thing pulsing together
    var twinkle = 0.775 + 0.225 * Math.sin(nowSeconds * star.twinkleSpeed + star.twinklePhase);
    fill(255, 255, 255, alpha * twinkle);
    var pos = starCanvasPosition(star);
    rect(pos.x, pos.y, star.size, star.size);
  }
}

// ---------------------------------------------------------------------------
// Parallax hills
//
// A second scrolling layer, farther back than the ground, so the background
// reads as having depth instead of just one moving strip. It scrolls at a
// fraction of the ground's speed - the classic parallax cue for "farther
// away" - tied to distanceTravelled like everything else so it stays in
// sync with the game's own pace (TIME_SCALE, speed ramp) rather than
// running on a separate clock.
// ---------------------------------------------------------------------------
var HILLS_PARALLAX_FACTOR = 0.35;
var HILLS_TILE_WIDTH = 300;
//one tile's worth of bumps: x offset within the tile, and each ellipse's width/height
var HILLS_BUMPS = [
  { x: 30, w: 130, h: 60 },
  { x: 130, w: 100, h: 40 },
  { x: 230, w: 150, h: 70 }
];
var HILLS_DAY_COLOR = [193, 168, 130];
var HILLS_NIGHT_COLOR = [30, 32, 52];

function drawHills(groundLineY, nightAmount) {
  var color = blendRgb(HILLS_DAY_COLOR, HILLS_NIGHT_COLOR, nightAmount);
  fill(color[0], color[1], color[2]);

  //only the top arc of each ellipse ends up visible - the sand rect drawn
  //right after this covers everything from groundLineY down
  var scrollX = -((distanceTravelled * HILLS_PARALLAX_FACTOR) % HILLS_TILE_WIDTH);
  var tileCount = Math.ceil(GAME_WIDTH / HILLS_TILE_WIDTH) + 2;
  for (var t = -1; t < tileCount; t++) {
    var tileX = scrollX + t * HILLS_TILE_WIDTH;
    for (var i = 0; i < HILLS_BUMPS.length; i++) {
      var bump = HILLS_BUMPS[i];
      ellipse(tileX + bump.x, groundLineY, bump.w, bump.h);
    }
  }
}

// Written only when it changes: assigning style.cursor every frame would dirty
// the element's style on each of up to 240 frames a second for no reason.
var appliedCursor = null;

function applyPointerCursor() {
  var wanted = pointerIsOverButton ? "pointer" : "default";
  if (wanted === appliedCursor) {
    return;
  }
  appliedCursor = wanted;
  var canvasElt = canvasElement();
  if (canvasElt) {
    canvasElt.style.cursor = wanted;
  }
}

function draw() {
  //trex.debug = true;
  //before anything reads width/height/viewOffsetY, so a viewport change the
  //browser never announced cannot leave this frame drawn to the old shape
  syncScreenLayout();
  //recomputed from scratch each frame by whichever buttons actually draw
  pointerIsOverButton = false;

  // p5.js 0.8.0 has no built-in deltaTime, so track it ourselves. dtFactor
  // is how many 60fps-reference-frames' worth of real time passed since the
  // last draw() call: 1 at exactly 60fps, ~4 at 240fps for a single frame,
  // etc. Clamped so a tab going to sleep doesn't cause a huge jump on wake.
  // Computed first because the day/night fade needs it before the sky is painted.
  var now = millis();
  var dt = now - lastFrameMillis;
  lastFrameMillis = now;
  var dtFactor = constrain(dt / (1000 / 60), 0, 3) * TIME_SCALE;

  if (gameState === PLAY) {
    var nightTarget = isNightMode() ? 1 : 0;
    //same clamp as dtFactor, so waking a sleeping tab doesn't skip the fade
    var fadeStep = constrain(dt, 0, 3 * 1000 / 60) / DAY_NIGHT_TRANSITION_MS;
    if (nightAmount < nightTarget) {
      nightAmount = Math.min(nightTarget, nightAmount + fadeStep);
    } else if (nightAmount > nightTarget) {
      nightAmount = Math.max(nightTarget, nightAmount - fadeStep);
    }
    updateStars(dtFactor);
  }

  var sky = blendRgb(DAY_SKY, NIGHT_SKY, nightAmount);
  background(sky[0], sky[1], sky[2]);
  noStroke();
  //painted before drawSprites(), so clouds and the trex pass in front of them
  drawStars(255 * nightAmount);
  //drawn before the sand rect, which covers everything below the ground line
  //and leaves just the hill tops poking above the horizon
  drawHills(viewOffsetY + 178, nightAmount);
  var sand = blendRgb(DAY_SAND, NIGHT_SAND, nightAmount);
  fill(sand[0], sand[1], sand[2]);
  //from the ground line all the way to the bottom of the screen
  rect(0, viewOffsetY + 178, width, height - (viewOffsetY + 178));

  // Text flips at the fade's midpoint instead of blending with it: a mid-grey
  // score over the mid-fade sky would be close to unreadable for a second.
  var textShade = nightAmount > 0.5 ? 255 : 0;

  // Everything from here down to pop() is drawn in gameplay-strip
  // coordinates (0-600 x 0-200), shifted to wherever the strip sits on screen.
  push();
  var shake = currentShakeOffset();
  translate(shake.x, viewOffsetY + shake.y);

  fill(textShade);

  handleMuteToggle();
  handlePauseToggle();

  // The branches below only move the game on. Nothing in them draws: each
  // screen's UI is painted by drawScreenOverlay() once the world is down - see
  // the comment there for why the order matters.
  if (gameState===PLAY){
    score = score + dtFactor;
    if (Math.floor(score) > highScore) {
      highScore = Math.floor(score);
    }
    if (score >= nextScoreMilestone) {
      playScoreMilestoneSound();
      scoreFlashStartMillis = millis();
      nextScoreMilestone += SCORE_MILESTONE_INTERVAL;
    }
    ground.velocityX = -currentSpeed() * dtFactor;
    distanceTravelled = distanceTravelled + currentSpeed() * dtFactor;

    if (ground.x < 0){
      ground.x = ground.width/2;
    }

    // trex.collide() zeroes the sprite's real velocity when it rests on the
    // ground, but that correction never reached our own trexVY accumulator -
    // gravity kept piling up every frame until the trex tunneled straight
    // through the thin ground collider. Reset trexVY too whenever grounded.
    //
    // This must run BEFORE the jump below, not after it. A resting trex sinks
    // a hair into the ground every frame, so collide() reports true on roughly
    // every other frame - and when a jump started on one of those frames, the
    // reset here (plus collide()'s own zero-bounce on the sprite's velocity)
    // wiped the jump velocity out the instant it was set. The jump sound
    // played, but the trex never left the ground.
    var grounded = trex.collide(invisibleGround);
    if (grounded) {
      trexVY = 0;
    }

    var airborne = trex.y < 159;
    var jumpedThisFrame = false;

    // Edge-triggered on a fresh press, not level-triggered on the key being
    // held: trex.y takes several frames to actually cross the airborne
    // threshold after a jump starts, so while still !airborne on those
    // frames, a held key (or held touch) used to re-enter this branch and
    // re-fire the jump - and its sound - repeatedly for a single press,
    // worse the faster the frame rate.
    // Jump takes priority over duck: a crouching trex stands up and jumps
    // rather than the jump being refused.
    //
    // Refusing it (the old `&& !isCrouching`) did not merely delay the jump -
    // it ate it. jumpKeyWasDown is assigned every frame regardless, so a press
    // blocked by the crouch was still recorded as "already seen", and the
    // edge-triggered test below could never fire for it again. The player had
    // to release jump and press it a second time.
    //
    // That is exactly the input the crow pair asks for - duck the high crow,
    // then immediately jump the low one - and on a phone, where releasing the
    // duck finger and tapping with another lands on the same frame far more
    // often than on a keyboard, it swallowed the jump most of the time.
    var jumpKeyIsDown = jumpPressed();
    if(jumpKeyIsDown && !jumpKeyWasDown && !airborne) {
      setCrouching(false);
      trexVY = JUMP_VELOCITY;
      jumpedThisFrame = true;
      playerHasJumped = true;
      playJumpSound();
    }
    jumpKeyWasDown = jumpKeyIsDown;

    // Let go while still climbing and the ascent is capped - see
    // JUMP_RELEASE_VELOCITY. Deliberately not gated on `airborne`, which is a
    // position test the trex has not satisfied yet in the first frames of a
    // jump; those early frames are exactly when a quick tap is released, so
    // gating on it would ignore the shortest taps of all.
    if (!jumpKeyIsDown && trexVY < JUMP_RELEASE_VELOCITY) {
      trexVY = JUMP_RELEASE_VELOCITY;
    }

    //fast-fall only makes sense while off the ground
    if(duckPressed() && airborne) {
      trexVY = trexVY + FAST_FALL_ACCEL * dtFactor;
    }

    trexVY = trexVY + GRAVITY * dtFactor;
    trex.velocityY = trexVY * dtFactor;

    // Duck like Chrome's dino while grounded, standing back up when released.
    // Gated on the same trex.y threshold the jump uses, not on `grounded`:
    // `grounded` only means "trex.collide() found overlap to correct this
    // frame", and setCrouching() teleports the sprite to exactly zero
    // penetration against the ground - so the very next frame there is
    // nothing to correct, grounded reads false, and using it here made the
    // crouch cancel itself one frame after starting.
    // The trexVY test matters now that a jump can begin from a crouch. A jump
    // takes several frames to lift the trex past the airborne threshold, and
    // during those frames a still-held duck key would otherwise re-crouch the
    // trex mid-ascent - which is precisely when the duck button is likely to
    // still be down, since the player has only just let go of it to jump.
    // While rising, neither branch applies and the crouch stays cleared.
    if (!airborne && !jumpedThisFrame && trexVY >= 0) {
      setCrouching(duckPressed());
    } else if (airborne) {
      setCrouching(false);
    }
    updateClouds(dtFactor);
    updateObstacles(dtFactor);
    spawnClouds();
    spawnObstacles();

    if (mpIsRacing) {
      mpSendState();
    }

    if(trexHitsAnyObstacle()){
        setCrouching(false);
        playDeathSound();
        deathEffectStartMillis = millis();
        //the run is over and the score is final - bank it here rather than
        //waiting to see whether the player ever presses restart
        persistHighScore();
        //a race crash goes to the result screen instead of Game Over: there is
        //no restarting mid-race, and the opponent may still be running
        if (mpIsRacing) {
          mpFinish(Math.floor(score));
        } else {
          gameState = END;
          raiseEndScreenSprites();
        }
        // Seed the "was this key already down" baseline with whatever the
        // player happens to be holding at the moment of death (very often
        // the jump key, since that's what you'd be pressing mid-obstacle).
        // Without this, dying while holding it would read as a fresh press
        // on the very next frame and instantly restart, skipping the Game
        // Over screen entirely.
        restartKeyWasDown = restartKeyDown();
    }
  }
  else if (gameState === END) {
    gameOver.visible = true;
    restart.visible = true;

    //set velcity of each game object to 0
    ground.velocityX = 0;
    trex.velocityY = 0;
    trexVY = 0;
    obstaclesGroup.setVelocityXEach(0);
    cloudsGroup.setVelocityXEach(0);

    //change the trex animation
    trex.changeAnimation("collided",trex_collided);

    // Restart on a fresh key PRESS, not while the key is simply held down -
    // keyDown() is level-triggered (true for every frame it's held), so
    // holding Enter/Space/etc. across a death would otherwise re-fire
    // reset() every single frame, forever.
    var restartKeyIsDown = restartKeyDown();
    if (restartRequested || (restartKeyIsDown && !restartKeyWasDown)) {
      reset();
    }
    restartKeyWasDown = restartKeyIsDown;

    //otherwise picking Single Player was a one-way trip - there was no way
    //back to the mode-select menu (to reach Multiplayer, say) once a run
    //had ended, short of reloading the page
    if (endMenuRequested || keyWentDown("esc")) {
      endMenuRequested = false;
      returnToMenu();
    }
  }
  else if (gameState === MENU) {
    updateMenuScenery(dtFactor);
    if (menuSinglePlayerRequested || keyWentDown("1")) {
      menuSinglePlayerRequested = false;
      //PLAY drives the ground from currentSpeed() every frame, so it only
      //needs stopping on the way to a screen that does not
      reset();
    } else if (menuMultiplayerRequested || keyWentDown("2")) {
      menuMultiplayerRequested = false;
      stopMenuScenery();
      gameState = MULTIPLAYER_MENU;
    }
  }
  else if (gameState === MULTIPLAYER_MENU) {
    if (multiplayerCreateRequested) {
      multiplayerCreateRequested = false;
      mpCreateRoom();
      gameState = MULTIPLAYER_WAITING;
    } else if (multiplayerJoinRequested) {
      multiplayerJoinRequested = false;
      mpConnectionMessage = null;
      gameState = MULTIPLAYER_JOIN_ENTRY;
      showRoomCodeInput();
    } else if (menuBackRequested || keyWentDown("esc")) {
      menuBackRequested = false;
      gameState = MENU;
    }
  }
  else if (gameState === MULTIPLAYER_WAITING) {
    mpCheckConnectTimeout();
    if (multiplayerLeaveRequested || keyWentDown("esc")) {
      multiplayerLeaveRequested = false;
      mpDisconnect();
      gameState = MULTIPLAYER_MENU;
    }
  }
  else if (gameState === MULTIPLAYER_COUNTDOWN) {
    // Leave is checked BEFORE the start time. Ordered the other way, a tap
    // landing on the final countdown frame lost to the time check - the race
    // began and left multiplayerLeaveRequested set, with nothing in PLAY to
    // consume it. It then sat there until the player crashed, at which point
    // the result screen read the stale flag on its very first frame and
    // bounced straight to the menu, skipping the result entirely.
    if (multiplayerLeaveRequested || keyWentDown("esc")) {
      multiplayerLeaveRequested = false;
      mpDisconnect();
      gameState = MULTIPLAYER_MENU;
    } else if (millis() >= mpRaceStartMillis) {
      startRace();
    }
  }
  else if (gameState === MULTIPLAYER_RESULT) {
    // Freeze the crash scene exactly as the END branch does, so the world
    // stops behind the result panel instead of drifting on.
    ground.velocityX = 0;
    trex.velocityY = 0;
    trexVY = 0;
    obstaclesGroup.setVelocityXEach(0);
    cloudsGroup.setVelocityXEach(0);
    trex.changeAnimation("collided", trex_collided);

    if (multiplayerRematchRequested || keyWentDown("r")) {
      multiplayerRematchRequested = false;
      mpRequestRematch();
    } else if (multiplayerLeaveRequested || keyWentDown("esc")) {
      multiplayerLeaveRequested = false;
      leaveRace();
    }
  }
  else if (gameState === MULTIPLAYER_JOIN_ENTRY) {
    if (multiplayerJoinSubmitRequested) {
      multiplayerJoinSubmitRequested = false;
      var enteredCode = roomCodeInputElt ? roomCodeInputElt.value : "";
      if (enteredCode.length === 4) {
        hideRoomCodeInput();
        mpJoinRoom(enteredCode);
        gameState = MULTIPLAYER_WAITING;
      }
    } else if (menuBackRequested || keyWentDown("esc")) {
      menuBackRequested = false;
      hideRoomCodeInput();
      gameState = MULTIPLAYER_MENU;
    }
  }

  //before drawSprites() so the player's own trex always draws on top of the
  //ghost, never the other way round
  drawOpponentGhost(dt);
  drawObstacleNightOutlines();
  drawSpriteNightOutline(trex, nightAmount);
  drawEndScreenNightOutlines();
  drawSprites();

  drawScreenOverlay();
  //last of all, so they stay lit and pressable above the pause dim - the
  //play button on that screen is the only way a phone player can resume
  drawHudControls();
  pop();

  //in the spare sky above the strip, so in screen space rather than strip space
  drawRotateHint();

  // Pinned to the real screen corner (not the 600x200 strip) so it stays in
  // the top-right border regardless of how much extra sky fullscreen adds
  // above the strip. Drawn after the world for the same reason the overlays
  // are: the clouds fly at the plate's height on a wide screen.
  //
  // "Press Start 2P" - a true monospace pixel font, matching the retro
  // arcade digit display the real Chrome dino uses. Monospace matters here
  // beyond just looking right: Bangers (tried first) has different widths
  // per digit, so as the score changed, the right-aligned text's rendered
  // width kept changing and the whole line visibly shifted left and right
  // every time a digit changed. Every character in a monospace font has the
  // same advance width, so that can't happen here.
  //
  // Neither is drawn on the race's own panel screens - see
  // raceScoreboardIsShown().
  if (raceScoreboardIsShown()) {
    drawRaceScoreboard();
  } else if (!inRaceView()) {
    drawScoreHud();
  }

  drawDeathFlash();
  applyPointerCursor();
}

// ---------------------------------------------------------------------------
// Rotate hint
//
// Held upright, a phone gives this game a strip about 390 pixels wide. The
// whole playfield shrinks to fit it - the smallest labels come out under five
// pixels tall - while two thirds of the screen above and below is empty sky
// and sand. Turning the phone sideways makes everything more than twice the
// size, and nothing said so.
//
// So a portrait touchscreen is told, in that empty sky, at a size it can
// actually read. Never during a run, where it would be something moving in
// the corner of the player's eye, and never on a screen without the room.
// ---------------------------------------------------------------------------
//enough sky above the strip for the card to sit clear of the score plate
var ROTATE_HINT_MIN_SKY = 300;
//how long the phone icon holds each pose before flipping to the other
var ROTATE_HINT_FLIP_MS = 900;
//the lowest the corner HUD reaches - the race scoreboard is the taller one
var ROTATE_HINT_HUD_BOTTOM = 110;

function rotateHintIsShown() {
  return playerIsOnTouch &&
         gameState !== PLAY &&
         viewportHeight() > viewportWidth() &&
         viewOffsetY >= ROTATE_HINT_MIN_SKY;
}

// Rectangles only, like the HUD icons: a phone body with its screen, drawn
// upright or on its side. Flipping between the two IS the instruction, so it
// reads without the words.
function drawPhoneIcon(x, y, sideways) {
  var w = sideways ? 56 : 32;
  var h = sideways ? 32 : 56;
  push();
  rectMode(CENTER);
  noStroke();
  fill(0, 0, 0, 70);
  rect(x + 3, y + 4, w, h);
  fill(PANEL_TEXT[0], PANEL_TEXT[1], PANEL_TEXT[2]);
  rect(x, y, w, h);
  //the screen, lit in the marquee amber once the phone is the right way round
  var lit = sideways ? BUTTON_PRIMARY.idle : PANEL_TEXT_DIM;
  fill(lit[0], lit[1], lit[2]);
  rect(x, y, w - (sideways ? 16 : 8), h - (sideways ? 8 : 16));
  pop();
}

function drawRotateHint() {
  if (!rotateHintIsShown()) {
    return;
  }
  //centred in the sky between the corner HUD and the top of the strip
  var cy = (ROTATE_HINT_HUD_BOTTOM + viewOffsetY) / 2;
  drawInkCard(GAME_WIDTH / 2, cy, 380, 160);
  drawPhoneIcon(GAME_WIDTH / 2, cy - 38,
                Math.floor(millis() / ROTATE_HINT_FLIP_MS) % 2 === 1);

  push();
  noStroke();
  textFont('"Press Start 2P", monospace');
  textAlign(CENTER, CENTER);
  //sized for a canvas shown at about two thirds scale, which is what a
  //portrait phone does to it - these come out around 14 and 9 CSS pixels
  textSize(22);
  panelFill(PANEL_TEXT);
  text("TURN SIDEWAYS", GAME_WIDTH / 2, cy + 26);
  textSize(14);
  panelFill(PANEL_TEXT_DIM);
  text("FOR A BIGGER VIEW", GAME_WIDTH / 2, cy + 56);
  pop();
}

// ---------------------------------------------------------------------------
// Screen overlays
//
// Every screen's own UI - panels, buttons, banners, hints - painted on top of
// a world that has already been drawn. It used to be drawn from inside each
// gameState branch of draw(), which ran BEFORE drawSprites(), so the world
// was painted over the interface: the ground line ran straight through every
// button, and clouds drifted across the result panel and the game-over card,
// covering the very scores they exist to show.
//
// Picked by the state draw() has just moved the game into, so a screen that
// changed this frame is shown this frame rather than one frame late.
// ---------------------------------------------------------------------------
function drawScreenOverlay() {
  if (gameState === PLAY) {
    if (mpIsRacing) {
      drawRaceGoFlash();
      drawOpponentGoneBanner();
    }
    drawControlsHint();
  } else if (gameState === END) {
    drawGameOverStats();
    drawButton(END_MENU_BUTTON, "MENU", BUTTON_SUBTLE);
  } else if (gameState === PAUSED) {
    drawPausedOverlay();
  } else if (gameState === MENU) {
    drawMenuScreen();
  } else if (gameState === MULTIPLAYER_MENU) {
    drawMultiplayerMenuScreen();
  } else if (gameState === MULTIPLAYER_WAITING) {
    drawMultiplayerWaitingScreen();
  } else if (gameState === MULTIPLAYER_COUNTDOWN) {
    drawMultiplayerCountdownScreen();
  } else if (gameState === MULTIPLAYER_RESULT) {
    drawMultiplayerResultScreen();
  } else if (gameState === MULTIPLAYER_JOIN_ENTRY) {
    drawMultiplayerJoinEntryScreen();
  }
}

// The GAME OVER art and the restart icon are sprites, so they are drawn by
// drawSprites() in depth order among everything else - and every cloud is
// handed a depth above the last, while every obstacle is created on top of
// all that exist. A few seconds into any run, clouds were already sorting in
// front of the words, and a cactus that happened to be mid-screen at the
// moment of the crash stood in front of the restart icon. Lifted above the
// whole world, once, at the moment they appear.
function raiseEndScreenSprites() {
  var top = Math.max(trex.depth, ground.depth);
  var groups = [obstaclesGroup, cloudsGroup];
  for (var g = 0; g < groups.length; g++) {
    for (var i = 0; i < groups[g].length; i++) {
      top = Math.max(top, groups[g][i].depth);
    }
  }
  gameOver.depth = top + 1;
  restart.depth = top + 2;
}

// Sprites are removed once they leave the screen rather than after a fixed
// time, so a slower game never makes them vanish while still in view.
function updateClouds(dtFactor) {
  for (var i = cloudsGroup.length - 1; i >= 0; i--) {
    var cloud = cloudsGroup[i];
    cloud.velocityX = cloud.baseVelocityX * dtFactor;
    if (cloud.x < -100) {
      cloud.remove();
    }
  }
}

function updateObstacles(dtFactor) {
  for (var i = obstaclesGroup.length - 1; i >= 0; i--) {
    var obstacle = obstaclesGroup[i];
    obstacle.velocityX = obstacle.baseVelocityX * dtFactor;
    if (obstacle.x < -100) {
      obstacle.remove();
    }
  }
}

function spawnClouds() {
  if (distanceTravelled - lastCloudSpawnDistance >= nextCloudGap) {
    lastCloudSpawnDistance = distanceTravelled;
    nextCloudGap = rollCloudGap();

    var cloud = createSprite(600,120,40,10);
    cloud.y = Math.round(random(65,125));
    cloud.addImage(cloudImage);
    //vary size and drift speed a little so the sky reads as having depth
    cloud.scale = random(0.35, 0.6);
    cloud.baseVelocityX = -CLOUD_SPEED * random(0.65, 1.25);

    //same fix as obstacles: push out by half-width so a big cloud doesn't
    //pop in already partway onto the screen
    var cloudWidth = cloud.animation.getFrameImage().width * Math.abs(cloud._getScaleX());
    cloud.x = GAME_WIDTH + cloudWidth / 2;

    //removed once off-screen by updateClouds() instead of by lifetime
    cloud.lifetime = -1;

    //adjust the depth
    cloud.depth = trex.depth;
    trex.depth = trex.depth + 1;

    //add each cloud to the group
    cloudsGroup.add(cloud);
  }
}

// ---------------------------------------------------------------------------
// Crow - a flying obstacle, drawn procedurally since the project ships no
// bird artwork. Two wing-flap frames feed into the same addAnimation()/
// imageProfile() pipeline every other obstacle uses, so silhouette collision,
// scaling and off-screen removal all just work without any special-casing.
// ---------------------------------------------------------------------------
var CROW_WIDTH = 46;
var CROW_HEIGHT = 30;
var crowFrame1, crowFrame2;

function buildCrowFrame(wingsUp) {
  var g = createGraphics(CROW_WIDTH, CROW_HEIGHT);
  g.clear();
  g.noStroke();
  g.fill(40, 40, 40);

  //body and head
  g.ellipse(CROW_WIDTH / 2, CROW_HEIGHT / 2, 20, 11);
  g.ellipse(CROW_WIDTH / 2 + 11, CROW_HEIGHT / 2 - 3, 10, 9);
  //beak
  g.triangle(CROW_WIDTH / 2 + 15, CROW_HEIGHT / 2 - 4,
             CROW_WIDTH / 2 + 23, CROW_HEIGHT / 2 - 1,
             CROW_WIDTH / 2 + 15, CROW_HEIGHT / 2 + 1);

  //wings as a wide V - raised mid-flap or lowered, for the two animation frames
  var wingY = wingsUp ? CROW_HEIGHT / 2 - 13 : CROW_HEIGHT / 2 + 11;
  g.triangle(CROW_WIDTH / 2, CROW_HEIGHT / 2, 2, wingY, CROW_WIDTH / 2 - 2, CROW_HEIGHT / 2 - 2);
  g.triangle(CROW_WIDTH / 2, CROW_HEIGHT / 2, CROW_WIDTH - 2, wingY, CROW_WIDTH / 2 + 2, CROW_HEIGHT / 2 - 2);

  return g.get();
}

// Where a crow's center sits in world y. Chosen so its bottom edge (~157.5,
// once scaled) clears the crouched trex's top (~159, see CROUCH_HEIGHT_FACTOR)
// but overlaps the standing trex's top (~138) - ducking is required to pass
// under it, matching Chrome dino's low pterodactyl.
var CROW_FLIGHT_Y = 150;

// How many obstacles must go by before crows are allowed to spawn at all, so
// the player meets a new obstacle type with some room to react rather than
// from the very first one - matching Chrome dino, where pterodactyls arrive
// partway into a run. Counted in obstacles rather than score because a score
// threshold is not reproducible across machines (see rule 2 above); obstacles
// arrive roughly every 75 points, so this sits where the old score gate of
// 150 did.
var CROW_MIN_OBSTACLE_INDEX = 2;

// Past this point a spawned crow has a chance of bringing a second crow close
// behind it at a much lower altitude - low enough it can't be ducked under, so
// it forces a duck immediately followed by a jump instead of just one
// reaction. Held back behind CROW_MIN_OBSTACLE_INDEX so single crows get
// introduced first, on their own. In obstacles rather than score for the same
// reproducibility reason; this is where the old score gate of 400 fell.
var CROW_PAIR_MIN_OBSTACLE_INDEX = 5;
var CROW_PAIR_CHANCE = 0.35;
var CROW_PAIR_GAP_PX = 90;
var CROW_COMPANION_FLIGHT_Y = 172;

function spawnCrowCompanion(lead) {
  var companion = createSprite(600, 165, 10, 40);
  companion.addAnimation("flying", crowFrame1, crowFrame2);
  companion.animation.frameDelay = 8;
  companion.scale = 0.5;
  companion.lifetime = -1;
  companion.baseVelocityX = lead.baseVelocityX;
  companion.y = CROW_COMPANION_FLIGHT_Y;
  //trails the lead crow in from off-screen at a fixed gap, so the pair scrolls in together
  companion.x = lead.x + CROW_PAIR_GAP_PX;
  obstaclesGroup.add(companion);
}

// ---------------------------------------------------------------------------
// Boulder - a ground obstacle, drawn procedurally like the crow. Unlike the
// six cacti (all tall and thin), it's low and wide, so it reads as a
// genuinely different shape to react to rather than another spiky plant.
// ---------------------------------------------------------------------------
var BOULDER_WIDTH = 70;
var BOULDER_HEIGHT = 46;
var boulderImage;

function buildBoulderImage() {
  var g = createGraphics(BOULDER_WIDTH, BOULDER_HEIGHT);
  g.clear();
  g.noStroke();

  //irregular rock outline instead of a plain ellipse, so it doesn't read as a boulder-shaped blob
  g.fill(95, 90, 85);
  g.beginShape();
  g.vertex(4, BOULDER_HEIGHT - 2);
  g.vertex(0, BOULDER_HEIGHT * 0.55);
  g.vertex(BOULDER_WIDTH * 0.18, BOULDER_HEIGHT * 0.2);
  g.vertex(BOULDER_WIDTH * 0.45, 0);
  g.vertex(BOULDER_WIDTH * 0.75, BOULDER_HEIGHT * 0.12);
  g.vertex(BOULDER_WIDTH - 2, BOULDER_HEIGHT * 0.5);
  g.vertex(BOULDER_WIDTH - 6, BOULDER_HEIGHT - 2);
  g.endShape(CLOSE);

  //a lighter facet and a darker crack give it some depth instead of a flat fill
  g.fill(120, 114, 108);
  g.triangle(BOULDER_WIDTH * 0.45, BOULDER_HEIGHT * 0.15,
             BOULDER_WIDTH * 0.7, BOULDER_HEIGHT * 0.2,
             BOULDER_WIDTH * 0.5, BOULDER_HEIGHT * 0.55);
  g.stroke(70, 66, 62);
  g.strokeWeight(1);
  g.line(BOULDER_WIDTH * 0.3, BOULDER_HEIGHT * 0.5, BOULDER_WIDTH * 0.4, BOULDER_HEIGHT - 4);

  return g.get();
}

function spawnObstacles() {
  if (distanceTravelled - lastObstacleSpawnDistance >= nextObstacleGap) {
    lastObstacleSpawnDistance = distanceTravelled;

    // All three draws happen unconditionally, in a fixed order, before any
    // gate below gets to decide what they mean - see rule 1 in the
    // deterministic obstacle stream block near the top of this file.
    var typeRoll = obstacleRandom();
    var pairRoll = obstacleRandom();
    var gapRoll = obstacleRandom();

    var obstacleIndex = obstaclesSpawned;
    obstaclesSpawned++;

    var obstacle = createSprite(600,165,10,40);
    //obstacle.debug = true;
    obstacle.baseVelocityX = -currentSpeed();

    // Math.round(random(1,6)) only gave types 1 and 6 half the chance of the
    // others (round maps a 0.5-wide band to each end but a full 1.0-wide band
    // to 2-5), so the same middle cacti kept showing up. Flooring across the
    // full range picks all eight (six cacti + crow + boulder) evenly.
    var rand = 1 + Math.floor(typeRoll * 8);
    if (rand === 7 && obstacleIndex < CROW_MIN_OBSTACLE_INDEX) {
      // Crows aren't unlocked yet, so this spawn becomes a cactus instead.
      // Re-uses the already-drawn pair roll - which only ever means anything
      // for a crow, so it is going spare here - rather than drawing a fresh
      // value, which would shift every later draw and desync the course.
      rand = 1 + Math.floor(pairRoll * 6);
    }
    var isCrow = rand === 7;
    switch(rand) {
      case 1: obstacle.addImage(obstacle1);
              break;
      case 2: obstacle.addImage(obstacle2);
              break;
      case 3: obstacle.addImage(obstacle3);
              break;
      case 4: obstacle.addImage(obstacle4);
              break;
      case 5: obstacle.addImage(obstacle5);
              break;
      case 6: obstacle.addImage(obstacle6);
              break;
      case 7: obstacle.addAnimation("flying", crowFrame1, crowFrame2);
              obstacle.animation.frameDelay = 8;
              playCrowSound();
              break;
      case 8: obstacle.addImage(boulderImage);
              break;
      default: break;
    }

    //removed once off-screen by updateObstacles() instead of by lifetime
    obstacle.scale = 0.5;
    obstacle.lifetime = -1;

    if (isCrow) {
      //flies at a fixed height instead of resting on the ground - see CROW_FLIGHT_Y
      obstacle.y = CROW_FLIGHT_Y;
    } else {
      // All six cactus images are spawned at the same fixed y regardless of
      // their actual height (35px drawn for obstacle1-3, 50px for obstacle4-6),
      // so the short cacti floated visibly above the ground line while the
      // tall ones sank into it. Re-anchor so every obstacle's bottom lands on
      // the same ground surface, matching where the trex's own feet rest.
      var drawnHeight = obstacle.animation.getFrameImage().height * Math.abs(obstacle._getScaleY());
      obstacle.y = GROUND_SURFACE_Y - drawnHeight / 2;
    }

    // Sprite x is its CENTER, so spawning every obstacle at a fixed x=600
    // (the canvas width) put up to half its width already inside the visible
    // area - the widest cactus cluster popped in 37.5px onto the screen
    // instead of sliding in from off-screen. Push it out by its own half-width.
    var drawnWidth = obstacle.animation.getFrameImage().width * Math.abs(obstacle._getScaleX());
    obstacle.x = GAME_WIDTH + drawnWidth / 2;

    //add each obstacle to the group
    obstaclesGroup.add(obstacle);

    var spawnedCrowPair = isCrow &&
                          obstacleIndex >= CROW_PAIR_MIN_OBSTACLE_INDEX &&
                          pairRoll < CROW_PAIR_CHANCE;
    if (spawnedCrowPair) {
      spawnCrowCompanion(obstacle);
    }

    lastObstacleWidth = obstacle.width * obstacle.scale;

    // A pair reaches CROW_PAIR_GAP_PX further than its lead does, but the next
    // gap is measured from where the LEAD spawned - so without adding that
    // reach back, the following obstacle arrived roughly 1.0 jump lengths
    // after the companion rather than the 1.35 minimum. Under one full jump
    // length means a player who ducked the pair correctly could land with no
    // room left to clear whatever came next, which is the sort of death that
    // reads as the game cheating rather than as a mistake.
    if (spawnedCrowPair) {
      lastObstacleWidth += CROW_PAIR_GAP_PX;
    }

    nextObstacleGap = rollObstacleGap(gapRoll);
  }
}

// Shared by reset() (back into a fresh single-player run) and returnToMenu()
// (back to the mode-select screen) - both need to wipe a finished run's
// state the same way, they just end up in a different gameState.
function resetGame(targetState) {
  gameState = targetState;
  runStartedMillis = millis();
  runStartHighScore = highScore;
  scoreFlashStartMillis = -1;
  restartRequested = false;
  gameOver.visible = false;
  restart.visible = false;
  setCrouching(false);
  deathEffectStartMillis = -1;

  // jumpKeyWasDown is only ever updated inside the PLAY branch of draw(), so
  // it stays frozen at whatever it was on the last PLAY frame before death.
  // Restarting is most often done with the same keys that jump (Space/Up/W),
  // so on the very next PLAY frame that held key looked like a brand-new
  // press - jumpKeyWasDown was still false - and fired an unwanted jump the
  // instant the trex respawned. Seed it with whatever's currently held, same
  // fix as restartKeyWasDown gets on death below.
  jumpKeyWasDown = jumpPressed();

  // destroyEach() calls a "destroy" method that does not exist on Sprite in
  // this version of p5.play, so it threw and aborted the whole restart.
  obstaclesGroup.removeSprites();
  cloudsGroup.removeSprites();

  trex.changeAnimation("running",trex_running);

  //highScore is already kept live (updated the instant it's beaten, in
  //draw()), so just persist it - no need to re-derive it from the score
  //this run ended with, or compare against the stringified localStorage value.
  //Usually already written by the death handler; this catches the runs that
  //end without one, such as leaving a race the opponent won.
  persistHighScore();

  score = 0;
  //a new run starts in daylight straight away, not with a 3s fade out of night
  nightAmount = 0;
  trexVY = 0;
  distanceTravelled = 0;
  lastObstacleSpawnDistance = 0;
  lastCloudSpawnDistance = 0;
  lastObstacleWidth = 0;
  //fresh course every run - and in a race, the one the server picked for both
  //players, so the same seed deliberately regenerates the same course
  seedObstacleStream(nextRunSeed());
  nextObstacleGap = rollObstacleGap(obstacleRandom());
  nextCloudGap = rollCloudGap();
  nextScoreMilestone = SCORE_MILESTONE_INTERVAL;
}

function reset() {
  resetGame(PLAY);
}

function returnToMenu() {
  resetGame(MENU);
}
