import {System} from "../../core/system";
import {Input} from "../../input/input";
import {resolveInputActions} from "../../input/inputMap";
import type {ResolvedInputActions} from "../../input/inputMap";
import {LocalPosition} from "../../translation/localPosition";
import {CAMERA_CONTROLLER_PRIORITY} from "../cameraControllerPriority";
import {PanCamera} from "./panCamera";

export const PanCameraAction = {
    Up: "panCameraUp",
    Down: "panCameraDown",
    Left: "panCameraLeft",
    Right: "panCameraRight",
} as const;

type PanCameraActions = ResolvedInputActions<typeof PanCameraAction>;

const NO_STEP = 0;
const POSITIVE = 1;
const NEGATIVE = -1;
const INCLUDING_DISABLED = {includeDisabled: true} as const;

export class PanCameraSystem extends System {
    private _cameras = this.createEntityQuery([PanCamera, LocalPosition]);
    private _actions!: PanCameraActions;

    override priority(): number {
        return CAMERA_CONTROLLER_PRIORITY;
    }

    protected onCreate(): void {
        this._actions = resolveInputActions(this.world, PanCameraAction);
    }

    onUpdate(): void {
        const input = this.world.resources.get(Input);
        const actions = this._actions;
        for (const event of input.events) {
            if (event.type !== "keyDown") continue;
            if (input.isActionEvent(event, actions.Up)) this.pan(NO_STEP, NEGATIVE);
            if (input.isActionEvent(event, actions.Down)) this.pan(NO_STEP, POSITIVE);
            if (input.isActionEvent(event, actions.Left)) this.pan(NEGATIVE, NO_STEP);
            if (input.isActionEvent(event, actions.Right)) this.pan(POSITIVE, NO_STEP);
        }
    }

    private pan(directionX: number, directionY: number): void {
        this._cameras.stream({read: {camera: PanCamera}, write: {position: LocalPosition}}, INCLUDING_DISABLED).consume(({camera, position}) => {
            if (directionX !== NO_STEP) position.x += directionX * camera.stepXUnits;
            if (directionY !== NO_STEP) position.y += directionY * camera.stepYUnits;
        });
    }
}
