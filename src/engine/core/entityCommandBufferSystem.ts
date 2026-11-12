import {System} from "./system";
import {EntityCommandBuffer} from "./entityCommandBuffer";

const UPDATE_LAST_PRIORITY = Number.POSITIVE_INFINITY;

export class EntityCommandBufferSystem extends System {
  private _buffer: EntityCommandBuffer = new EntityCommandBuffer();

  public getEntityCommandBuffer(): EntityCommandBuffer {
    return this._buffer;
  }

  priority(): number {
    return UPDATE_LAST_PRIORITY
  }

  public onUpdate(): void {
    if (this._buffer.isEmpty) return;
    this._buffer.playback(this.entityManager);
  }
}