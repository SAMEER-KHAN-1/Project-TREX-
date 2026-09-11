var PLAY = 1;
var END = 0;
var gameState = PLAY;

var trex, trex_running, trex_collided;
var ground, invisibleGround, groundImage;

var cloudsGroup, cloudImage;
var obstaclesGroup, obstacle1, obstacle2, obstacle3, obstacle4, obstacle5, obstacle6;

var score = 0;

var gameOver, restart;

var touchIsDown = false;

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

// Jump: space, up arrow, W, or a screen tap. Duck/fast-fall: down arrow or S
// (ducks like Chrome's dino while grounded, fast-falls while airborne).
function jumpPressed() {
  return keyDown("space") || keyDown("up") || keyDown("w") || touchIsDown;
}

function duckPressed() {
  return keyDown("down") || keyDown("s");
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

function rollObstacleGap() {
  var airtimeFrames = 2 * Math.abs(JUMP_VELOCITY) / GRAVITY;
  var jumpDistance = airtimeFrames * currentSpeed();
  return lastObstacleWidth +
         jumpDistance * random(OBSTACLE_GAP_MIN_JUMPS, OBSTACLE_GAP_MAX_JUMPS);
}

function rollCloudGap() {
  return random(CLOUD_GAP_MIN_PX, CLOUD_GAP_MAX_PX);
}

if (!localStorage["HighestScore"]) {
  localStorage["HighestScore"] = 0;
}
//kept as a live number so it can update mid-run, not just read from
//localStorage (a string) when the game ends
var highScore = Number(localStorage["HighestScore"]) || 0;

function padScore(n) {
  var s = String(Math.floor(n));
  while (s.length < 5) {
    s = "0" + s;
  }
  return s;
}

function touchStarted() {
  touchIsDown = true;
}

function touchEnded() {
  touchIsDown = false;
}

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

// Set by the canvas pointer handler below and consumed in draw().
var restartRequested = false;

// p5.play maps pointer positions with canvas.offsetWidth (the CSS size)
// instead of canvas.width (the drawing buffer), so mouseX/mouseY come back
// in screen pixels once the canvas is scaled to fill the window - which
// broke mousePressedOver(). Do the conversion properly ourselves.
function canvasPointerToGame(evt) {
  var canvasElt = document.querySelector("canvas");
  if (!canvasElt) {
    return null;
  }
  var rect = canvasElt.getBoundingClientRect();
  if (!rect.width || !rect.height) {
    return null;
  }
  return {
    x: (evt.clientX - rect.left) * (GAME_WIDTH / rect.width),
    y: (evt.clientY - rect.top) * (GAME_HEIGHT / rect.height)
  };
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

function onCanvasPointerDown(evt) {
  var point = canvasPointerToGame(evt);
  if (point && isOverRestart(point.x, point.y)) {
    restartRequested = true;
  }
}

var GAME_WIDTH = 600;
var GAME_HEIGHT = 200;

function fillScreen() {
  var scaleFactor = Math.min(windowWidth / GAME_WIDTH, windowHeight / GAME_HEIGHT);
  var canvasElt = document.querySelector("canvas");
  if (canvasElt) {
    canvasElt.style.width = (GAME_WIDTH * scaleFactor) + "px";
    canvasElt.style.height = (GAME_HEIGHT * scaleFactor) + "px";
  }
}

function windowResized() {
  fillScreen();
}

function preload(){
  trex_running =   loadAnimation("trex1.png","trex3.png","trex4.png");
  trex_collided = loadAnimation("trex_collided.png");

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
  var canvasElt = document.querySelector("canvas");
  if (canvasElt) {
    canvasElt.addEventListener("pointerdown", onCanvasPointerDown);
  }

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
  ground.velocityX = -BASE_SPEED;

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

  score = 0;
  trexVY = 0;
  lastFrameMillis = millis();
  distanceTravelled = 0;
  lastObstacleSpawnDistance = 0;
  lastCloudSpawnDistance = 0;
  lastObstacleWidth = 0;
  nextObstacleGap = rollObstacleGap();
  nextCloudGap = rollCloudGap();
}

function draw() {
  //trex.debug = true;
  background(135, 206, 235); // sky blue
  noStroke();
  fill(222, 184, 135); // sandy ground
  rect(0, 178, GAME_WIDTH, GAME_HEIGHT - 178);
  fill(0);
  text("HI " + padScore(highScore) + "   " + padScore(score), 430, 50);

  // p5.js 0.8.0 has no built-in deltaTime, so track it ourselves. dtFactor
  // is how many 60fps-reference-frames' worth of real time passed since the
  // last draw() call: 1 at exactly 60fps, ~4 at 240fps for a single frame,
  // etc. Clamped so a tab going to sleep doesn't cause a huge jump on wake.
  var now = millis();
  var dt = now - lastFrameMillis;
  lastFrameMillis = now;
  var dtFactor = constrain(dt / (1000 / 60), 0, 3) * TIME_SCALE;

  if (gameState===PLAY){
    score = score + dtFactor;
    if (Math.floor(score) > highScore) {
      highScore = Math.floor(score);
    }
    ground.velocityX = -currentSpeed() * dtFactor;
    distanceTravelled = distanceTravelled + currentSpeed() * dtFactor;

    var airborne = trex.y < 159;
    var jumpedThisFrame = false;

    //jump takes priority over duck: a held duck key must not cancel a jump
    if(jumpPressed() && !airborne && !isCrouching) {
      trexVY = JUMP_VELOCITY;
      jumpedThisFrame = true;
    }

    //fast-fall only makes sense while off the ground
    if(duckPressed() && airborne) {
      trexVY = trexVY + FAST_FALL_ACCEL * dtFactor;
    }

    trexVY = trexVY + GRAVITY * dtFactor;
    trex.velocityY = trexVY * dtFactor;

    if (ground.x < 0){
      ground.x = ground.width/2;
    }

    // trex.collide() zeroes the sprite's real velocity when it rests on the
    // ground, but that correction never reached our own trexVY accumulator -
    // gravity kept piling up every frame until the trex tunneled straight
    // through the thin ground collider. Reset trexVY too whenever grounded.
    var grounded = trex.collide(invisibleGround);
    if (grounded) {
      trexVY = 0;
    }

    // Duck like Chrome's dino while grounded, standing back up when released.
    // Gated on the same trex.y threshold the jump uses, not on `grounded`:
    // `grounded` only means "trex.collide() found overlap to correct this
    // frame", and setCrouching() teleports the sprite to exactly zero
    // penetration against the ground - so the very next frame there is
    // nothing to correct, grounded reads false, and using it here made the
    // crouch cancel itself one frame after starting.
    if (!airborne && !jumpedThisFrame) {
      setCrouching(duckPressed());
    } else if (airborne) {
      setCrouching(false);
    }
    updateClouds(dtFactor);
    updateObstacles(dtFactor);
    spawnClouds();
    spawnObstacles();

    if(trexHitsAnyObstacle()){
        gameState = END;
        setCrouching(false);
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

    if(restartRequested || keyDown("enter")) {
      reset();
    }
  }


  drawSprites();
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

    //removed once off-screen by updateClouds() instead of by lifetime
    cloud.lifetime = -1;

    //adjust the depth
    cloud.depth = trex.depth;
    trex.depth = trex.depth + 1;

    //add each cloud to the group
    cloudsGroup.add(cloud);
  }
}

function spawnObstacles() {
  if (distanceTravelled - lastObstacleSpawnDistance >= nextObstacleGap) {
    lastObstacleSpawnDistance = distanceTravelled;

    var obstacle = createSprite(600,165,10,40);
    //obstacle.debug = true;
    obstacle.baseVelocityX = -currentSpeed();

    // Math.round(random(1,6)) only gave types 1 and 6 half the chance of the
    // others (round maps a 0.5-wide band to each end but a full 1.0-wide band
    // to 2-5), so the same middle cacti kept showing up. floor(random(1,7))
    // picks all six evenly.
    var rand = Math.floor(random(1,7));
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
      default: break;
    }

    //removed once off-screen by updateObstacles() instead of by lifetime
    obstacle.scale = 0.5;
    obstacle.lifetime = -1;
    //add each obstacle to the group
    obstaclesGroup.add(obstacle);

    lastObstacleWidth = obstacle.width * obstacle.scale;
    nextObstacleGap = rollObstacleGap();
  }
}

function reset(){
  gameState = PLAY;
  restartRequested = false;
  gameOver.visible = false;
  restart.visible = false;
  setCrouching(false);

  // destroyEach() calls a "destroy" method that does not exist on Sprite in
  // this version of p5.play, so it threw and aborted the whole restart.
  obstaclesGroup.removeSprites();
  cloudsGroup.removeSprites();

  trex.changeAnimation("running",trex_running);

  //highScore is already kept live (updated the instant it's beaten, in
  //draw()), so just persist it - no need to re-derive it from the score
  //this run ended with, or compare against the stringified localStorage value
  localStorage["HighestScore"] = highScore;
  console.log(localStorage["HighestScore"]);

  score = 0;
  trexVY = 0;
  distanceTravelled = 0;
  lastObstacleSpawnDistance = 0;
  lastCloudSpawnDistance = 0;
  lastObstacleWidth = 0;
  nextObstacleGap = rollObstacleGap();
  nextCloudGap = rollCloudGap();
}
