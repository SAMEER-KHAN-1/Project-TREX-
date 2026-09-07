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
var lastCloudSpawnTime = 0;
var lastObstacleSpawnTime = 0;
var CLOUD_INTERVAL_MS = 1000;
var OBSTACLE_INTERVAL_MS = 1000;
var CLOUD_LIFETIME_MS = (200 / 60) * 1000;
var OBSTACLE_LIFETIME_MS = (300 / 60) * 1000;

if (!localStorage["HighestScore"]) {
  localStorage["HighestScore"] = 0;
}

function touchStarted() {
  touchIsDown = true;
}

function touchEnded() {
  touchIsDown = false;
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
  ground.velocityX = -(6 + 3*score/100);

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
  lastCloudSpawnTime = millis();
  lastObstacleSpawnTime = millis();
}

function draw() {
  //trex.debug = true;
  background(150);
  text("Score: "+ Math.floor(score), 500,50);

  // p5.js 0.8.0 has no built-in deltaTime, so track it ourselves. dtFactor
  // is how many 60fps-reference-frames' worth of real time passed since the
  // last draw() call: 1 at exactly 60fps, ~4 at 240fps for a single frame,
  // etc. Clamped so a tab going to sleep doesn't cause a huge jump on wake.
  var now = millis();
  var dt = now - lastFrameMillis;
  lastFrameMillis = now;
  var dtFactor = constrain(dt / (1000 / 60), 0, 3);

  if (gameState===PLAY){
    score = score + dtFactor;
    ground.velocityX = -(6 + 3*Math.floor(score)/100) * dtFactor;

    if((keyDown("space") || touchIsDown) && trex.y >= 159) {
      trexVY = -12;
    }

    trexVY = trexVY + 0.8 * dtFactor;
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

    if(mousePressedOver(restart)) {
      reset();
    }
  }


  drawSprites();
}

function updateClouds(dtFactor) {
  for (var i = cloudsGroup.length - 1; i >= 0; i--) {
    var cloud = cloudsGroup[i];
    cloud.velocityX = cloud.baseVelocityX * dtFactor;
    if (millis() - cloud.spawnTime > CLOUD_LIFETIME_MS) {
      cloud.remove();
    }
  }
}

function updateObstacles(dtFactor) {
  for (var i = obstaclesGroup.length - 1; i >= 0; i--) {
    var obstacle = obstaclesGroup[i];
    obstacle.velocityX = obstacle.baseVelocityX * dtFactor;
    if (millis() - obstacle.spawnTime > OBSTACLE_LIFETIME_MS) {
      obstacle.remove();
    }
  }
}

function spawnClouds() {
  if (millis() - lastCloudSpawnTime >= CLOUD_INTERVAL_MS) {
    lastCloudSpawnTime = millis();

    var cloud = createSprite(600,120,40,10);
    cloud.y = Math.round(random(80,120));
    cloud.addImage(cloudImage);
    cloud.scale = 0.5;
    cloud.baseVelocityX = -3;
    cloud.spawnTime = millis();

    //lifetime is managed manually via spawnTime/CLOUD_LIFETIME_MS above
    cloud.lifetime = -1;

    //adjust the depth
    cloud.depth = trex.depth;
    trex.depth = trex.depth + 1;

    //add each cloud to the group
    cloudsGroup.add(cloud);
  }
}

function spawnObstacles() {
  if (millis() - lastObstacleSpawnTime >= OBSTACLE_INTERVAL_MS) {
    lastObstacleSpawnTime = millis();

    var obstacle = createSprite(600,165,10,40);
    //obstacle.debug = true;
    obstacle.baseVelocityX = -(6 + 3*Math.floor(score)/100);
    obstacle.spawnTime = millis();

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

    //assign scale to the obstacle; lifetime is managed manually above
    obstacle.scale = 0.5;
    obstacle.lifetime = -1;
    //add each obstacle to the group
    obstaclesGroup.add(obstacle);
  }
}

function reset(){
  gameState = PLAY;
  gameOver.visible = false;
  restart.visible = false;

  obstaclesGroup.destroyEach();
  cloudsGroup.destroyEach();

  trex.changeAnimation("running",trex_running);

  if(localStorage["HighestScore"] < Math.floor(score)){
    localStorage["HighestScore"] = Math.floor(score);
  }
  console.log(localStorage["HighestScore"]);

  score = 0;
  trexVY = 0;
  lastCloudSpawnTime = millis();
  lastObstacleSpawnTime = millis();
}
