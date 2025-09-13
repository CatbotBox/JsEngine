import {System} from "./system";
import {EntityCommandBuffer} from "./entityCommandBuffer";

export class EntityCommandBufferSystem extends System {
  private _buffer: EntityCommandBuffer = new EntityCommandBuffer();

  public get buffer(): EntityCommandBuffer {
    return this._buffer;
  }

  priority(): number {
    // always update last
    return Number.POSITIVE_INFINITY
  }

  public onUpdate(): void {
    this._buffer.playback(this.entityManager);
  }
}