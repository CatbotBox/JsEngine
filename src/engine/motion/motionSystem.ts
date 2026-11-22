import {System} from "../core/system";
import {LocalPosition} from "../translation/localPosition";
import {Velocity} from "./velocity";

export const MOTION_PRIORITY = -30;

const MS_PER_SECOND = 1000;
const POSITION_STRIDE = LocalPosition.f32Width;
const POSITION_X = 0;
const POSITION_Y = 1;
const POSITION_Z = 2;

export class MotionSystem extends System {
    private _moving = this.createEntityQuery([Velocity, LocalPosition]);

    override priority(): number {
        return MOTION_PRIORITY;
    }

    protected onCreate(): void {
        this.requireAnyForUpdate(this._moving);
    }

    protected stepMs(): number {
        return this.world.time.deltaTimeMs;
    }

    onUpdate(): void {
        const stepSeconds = this.stepMs() / MS_PER_SECOND;
        this._moving.stream({read: {velocity: Velocity}, write: {position: LocalPosition}}).consumeSpans(({start, end, cols, stores}) => {
            const positions = cols.position!, velocities = stores.velocity!;
            for (let i = start; i < end; i++) {
                const velocity = velocities.get(i) as Velocity;
                const p = i * POSITION_STRIDE;
                positions[p + POSITION_X] += velocity.xUnitsPerSecond * stepSeconds;
                positions[p + POSITION_Y] += velocity.yUnitsPerSecond * stepSeconds;
                positions[p + POSITION_Z] += velocity.zUnitsPerSecond * stepSeconds;
            }
        });
    }
}
