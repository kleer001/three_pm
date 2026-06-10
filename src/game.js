// Minimal placeholder loop. Real structure comes from the architecture sketch.
export class Game {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.lastTime = 0;
    this.tick = this.tick.bind(this);
  }

  start() {
    requestAnimationFrame(this.tick);
  }

  tick(time) {
    const dt = (time - this.lastTime) / 1000;
    this.lastTime = time;
    this.update(dt);
    this.render();
    requestAnimationFrame(this.tick);
  }

  update(_dt) {}

  render() {
    const { ctx, canvas } = this;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#1a1a1a";
    ctx.font = "16px system-ui, sans-serif";
    ctx.fillText("three_pm — scaffold ready", 20, 30);
  }
}
