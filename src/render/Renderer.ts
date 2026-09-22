import { FreeCamera } from '@babylonjs/core/Cameras/freeCamera';
import { Engine } from '@babylonjs/core/Engines/engine';
import { Color4 } from '@babylonjs/core/Maths/math.color';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Scene } from '@babylonjs/core/scene';

export class Renderer {
  private readonly engine: Engine;
  private readonly scene: Scene;
  private readonly resize = () => this.engine.resize();

  constructor(canvas: HTMLCanvasElement) {
    this.engine = new Engine(canvas, true);
    this.scene = new Scene(this.engine);
    this.scene.clearColor = new Color4(0.08, 0.12, 0.16, 1);
    const camera = new FreeCamera('camera', new Vector3(0, 0, -10), this.scene);
    camera.setTarget(Vector3.Zero());

    window.addEventListener('resize', this.resize);
    this.engine.runRenderLoop(() => this.scene.render());
  }

  dispose() {
    window.removeEventListener('resize', this.resize);
    this.engine.stopRenderLoop();
    this.scene.dispose();
    this.engine.dispose();
  }
}
