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

// Extra downward pull for the fast-fall keys. There is no ducking sprite in
// this project, so down/S drops the trex out of a jump quickly instead.
var FAST_FALL_ACCEL = 1.6;

// Jump: space, up arrow, W, or a screen tap. Fast-fall: down arrow or S.
function jumpPressed() {
  return keyDown("space") || keyDown("up") || keyDown("w") || touchIsDown;
}

function fastFallPressed() {
  return keyDown("down") || keyDown("s");
}

function currentSpeed() {
  return Math.min(BASE_SPEED + SPEED_PER_100_SCORE * Math.floor(score) / 100, MAX_SPEED);
}

// Obstacles and clouds are spaced by distance travelled, not by a timer, so
// the gaps between them stay the same no matter how slow or fast the game runs.
var OBSTACLE_GAP_PX = 350;
var CLOUD_GAP_PX = 250;
var distanceTravelled = 0;
var lastObstacleSpawnDistance = 0;
var lastCloudSpawnDistance = 0;

if (!localStorage["HighestScore"]) {
  localStorage["HighestScore"] = 0;
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
}

function draw() {
  //trex.debug = true;
  background(135, 206, 235); // sky blue
  noStroke();
  fill(222, 184, 135); // sandy ground
  rect(0, 178, GAME_WIDTH, GAME_HEIGHT - 178);
  fill(0);
  text("Score: "+ Math.floor(score), 500,50);

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
    ground.velocityX = -currentSpeed() * dtFactor;
    distanceTravelled = distanceTravelled + currentSpeed() * dtFactor;

    if(jumpPressed() && trex.y >= 159) {
      trexVY = JUMP_VELOCITY;
    }

    //fast-fall only makes sense while off the ground
    if(fastFallPressed() && trex.y < 159) {
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
    updateClouds(dtFactor);
    updateObstacles(dtFactor);
    spawnClouds();
    spawnObstacles();

    if(obstaclesGroup.isTouching(trex)){
        gameState = END;
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
  if (distanceTravelled - lastCloudSpawnDistance >= CLOUD_GAP_PX) {
    lastCloudSpawnDistance = distanceTravelled;

    var cloud = createSprite(600,120,40,10);
    cloud.y = Math.round(random(80,120));
    cloud.addImage(cloudImage);
    cloud.scale = 0.5;
    cloud.baseVelocityX = -CLOUD_SPEED;

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
  if (distanceTravelled - lastObstacleSpawnDistance >= OBSTACLE_GAP_PX) {
    lastObstacleSpawnDistance = distanceTravelled;

    var obstacle = createSprite(600,165,10,40);
    //obstacle.debug = true;
    obstacle.baseVelocityX = -currentSpeed();

    //generate random obstacles
    var rand = Math.round(random(1,6));
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
  }
}

function reset(){
  gameState = PLAY;
  restartRequested = false;
  gameOver.visible = false;
  restart.visible = false;

  // destroyEach() calls a "destroy" method that does not exist on Sprite in
  // this version of p5.play, so it threw and aborted the whole restart.
  obstaclesGroup.removeSprites();
  cloudsGroup.removeSprites();

  trex.changeAnimation("running",trex_running);

  if(localStorage["HighestScore"] < Math.floor(score)){
    localStorage["HighestScore"] = Math.floor(score);
  }
  console.log(localStorage["HighestScore"]);

  score = 0;
  trexVY = 0;
  distanceTravelled = 0;
  lastObstacleSpawnDistance = 0;
  lastCloudSpawnDistance = 0;
}
