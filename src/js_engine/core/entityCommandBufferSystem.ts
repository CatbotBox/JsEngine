import {System} from "./system";
import {EntityCommandBuffer} from "./entityCommandBuffer";

export class EntityCommandBufferSystem extends System {
  private _buffer: EntityCommandBuffer = new EntityCommandBuffer();

  public getEntityCommandBuffer(): EntityCommandBuffer {
    return this._buffer;
  }

  priority(): number {
    // always update last
    return Number.POSITIVE_INFINITY
  }

  public onUpdate(): void {
    if (this._buffer.isEmpty) return;
    this._buffer.playback(this.entityManager);
  }
}