var horizontalCount;
var verticalCount = 5;

var speed = 0.5;
var initialSpacing = 5;
var waveSize = 10;
var lineLength = 10;
var spacing = 50;

function setup() {
  createCanvas(windowWidth, 280);
  horizontalCount = round(width / spacing);
}

function draw() {
  background("#141414");
  strokeWeight(2);
  for (var i = 0; i <= horizontalCount; i += 1) {
    for (var j = 0; j <= verticalCount; j += 1) {
      push();

      var inter = map(i, 0, width, 0, spacing);
      var c = lerpColor(color("rgba(50, 182, 239, 0.3)"), color("rgba(50, 239, 213, 0.3)"), inter);
      stroke(c);

      var lineX = i*spacing + initialSpacing;
      var lineY = j*spacing + initialSpacing;

      var dx = mouseX - i*spacing;
      var dy = mouseY - j*spacing;
      var r = atan2(dy, dx);

      translate(i*spacing + initialSpacing, j*spacing + initialSpacing);
      rotate(radians(frameCount * speed + i * 10 + j * 10) + r);
      translate(-i*spacing - initialSpacing, -j*spacing - initialSpacing);

      line(lineX - lineLength + waveSize, lineY, lineX + lineLength + waveSize, lineY);
      pop();
    }
  }
}
