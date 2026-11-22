import {System} from "../../core/system";
import {Input} from "../../input/input";
import type {InputEvent, KeyDownEvent} from "../../input/inputEvent";
import {resolveInputActions} from "../../input/inputMap";
import type {ResolvedInputActions} from "../../input/inputMap";
import {Quaternions} from "../../math/quaternions";
import {Vec} from "../../math/types/vec";
import type {ReadonlyVec3, ReadonlyVec4, Vec3, Vec4} from "../../math/types/vec";
import {FieldOfView} from "../../rendering/3d/fieldOfView";
import {SCREEN_UNIT_HEIGHT_PER_WIDTH} from "../../rendering/screenUnits";
import {LocalPosition} from "../../translation/localPosition";
import {LocalRotation} from "../../translation/localRotation";
import {CAMERA_CONTROLLER_PRIORITY} from "../cameraControllerPriority";
import {FlyCamera} from "./flyCamera";

export const FlyCameraAction = {
    MoveForward: "flyCameraForward",
    MoveBackward: "flyCameraBackward",
    MoveRight: "flyCameraRight",
    MoveLeft: "flyCameraLeft",
    MoveDown: "flyCameraDown",
    MoveUp: "flyCameraUp",
    ZoomIn: "flyCameraZoomIn",
    ZoomOut: "flyCameraZoomOut",
    Look: "flyCameraLook",
} as const;

type FlyCameraActions = ResolvedInputActions<typeof FlyCameraAction>;
type FieldOfViewChange = (fieldOfView: FieldOfView, camera: Readonly<FlyCamera>) => void;

const QUARTER_TURN_RAD = Math.PI / 2;
const SCREEN_UNIT_WIDTH_PER_HEIGHT = 1 / SCREEN_UNIT_HEIGHT_PER_WIDTH;
const NO_ROLL_RAD = 0;
const POSITIVE = 1;
const NEGATIVE = -1;
const FORWARD: ReadonlyVec3 = Vec.alloc3(0, 0, 1);
const RIGHT: ReadonlyVec3 = Vec.alloc3(1, 0, 0);
const INCLUDING_DISABLED = {includeDisabled: true} as const;

const zoomIn: FieldOfViewChange = (fieldOfView, camera) => {
    fieldOfView.degrees /= camera.fovKeyStep;
};

const zoomOut: FieldOfViewChange = (fieldOfView, camera) => {
    fieldOfView.degrees *= camera.fovKeyStep;
};

function cameraRotationOf(camera: Readonly<FlyCamera>, scratch: Vec3): Vec4 {
    return Quaternions.eulerToQuat(Vec.set3(scratch, camera.pitchRad, camera.yawRad, NO_ROLL_RAD));
}

function rotateByQuat(q: ReadonlyVec4, v: ReadonlyVec3, out: Vec3): Vec3 {
    const x = Vec.x(q), y = Vec.y(q), z = Vec.z(q), w = Vec.w(q);
    const vx = Vec.x(v), vy = Vec.y(v), vz = Vec.z(v);
    const tx = 2 * (y * vz - z * vy);
    const ty = 2 * (z * vx - x * vz);
    const tz = 2 * (x * vy - y * vx);
    return Vec.set3(out,
        vx + w * tx + (y * tz - z * ty),
        vy + w * ty + (z * tx - x * tz),
        vz + w * tz + (x * ty - y * tx),
    );
}

export class FlyCameraSystem extends System {
    private _cameras = this.createEntityQuery([FlyCamera, LocalPosition, LocalRotation]);
    private _zoomCameras = this.createEntityQuery([FlyCamera, FieldOfView]);
    private _actions!: FlyCameraActions;
    private readonly _eulerScratch: Vec3 = Vec.alloc3();
    private readonly _directionScratch: Vec3 = Vec.alloc3();
    private _lastPointerX = 0;
    private _lastPointerY = 0;
    private _looking = false;

    override priority(): number {
        return CAMERA_CONTROLLER_PRIORITY;
    }

    protected onCreate(): void {
        this._actions = resolveInputActions(this.world, FlyCameraAction);
    }

    onUpdate(): void {
        const input = this.world.resources.get(Input);
        for (const event of input.events) {
            if (event.type === "keyDown") this.handleKey(input, event);
            else this.handlePointer(input, event);
        }
    }

    private handleKey(input: Input, event: KeyDownEvent): void {
        const actions = this._actions;
        if (input.isActionEvent(event, actions.MoveForward)) this.move(FORWARD, POSITIVE);
        if (input.isActionEvent(event, actions.MoveBackward)) this.move(FORWARD, NEGATIVE);
        if (input.isActionEvent(event, actions.MoveRight)) this.move(RIGHT, POSITIVE);
        if (input.isActionEvent(event, actions.MoveLeft)) this.move(RIGHT, NEGATIVE);
        if (input.isActionEvent(event, actions.MoveDown)) this.raise(NEGATIVE);
        if (input.isActionEvent(event, actions.MoveUp)) this.raise(POSITIVE);
        if (input.isActionEvent(event, actions.ZoomIn)) this.zoom(zoomIn);
        if (input.isActionEvent(event, actions.ZoomOut)) this.zoom(zoomOut);
    }

    private handlePointer(input: Input, event: InputEvent): void {
        switch (event.type) {
            case "pointerDown":
                if (!input.isActionEvent(event, this._actions.Look)) return;
                this._looking = true;
                this._lastPointerX = event.x;
                this._lastPointerY = event.y;
                return;
            case "pointerUp":
                if (input.isActionEvent(event, this._actions.Look)) this._looking = false;
                return;
            case "pointerMove": {
                if (!this._looking) return;
                const dx = event.x - this._lastPointerX;
                const dy = event.y - this._lastPointerY;
                this._lastPointerX = event.x;
                this._lastPointerY = event.y;
                this.look(dx, dy);
                return;
            }
            case "wheel": {
                const delta = event.delta;
                this.zoom((fieldOfView, camera) => {
                    fieldOfView.degrees = Math.max(camera.minFovDegrees, Math.min(camera.maxFovDegrees, fieldOfView.degrees * Math.pow(camera.fovWheelStep, -delta)));
                });
                return;
            }
        }
    }

    private move(localDirection: ReadonlyVec3, sign: number): void {
        this._cameras.stream({read: {camera: FlyCamera}, write: {position: LocalPosition}}, INCLUDING_DISABLED).consume(({camera, position}) => {
            const amount = sign * camera.moveStepUnits;
            const direction = rotateByQuat(cameraRotationOf(camera, this._eulerScratch), localDirection, this._directionScratch);
            const dx = Vec.x(direction), dy = Vec.y(direction), dz = Vec.z(direction);
            position.x += dx * amount;
            position.y += dy * amount;
            position.z += dz * amount;
        });
    }

    private raise(sign: number): void {
        this._cameras.stream({read: {camera: FlyCamera}, write: {position: LocalPosition}}, INCLUDING_DISABLED).consume(({camera, position}) => {
            position.y += sign * camera.moveStepUnits;
        });
    }

    private look(dx: number, dy: number): void {
        this._cameras.stream({write: {camera: FlyCamera, rotation: LocalRotation}}, INCLUDING_DISABLED).consume(({camera, rotation}) => {
            const pitchLimit = QUARTER_TURN_RAD - camera.pitchMarginRad;
            camera.yawRad += dx * camera.lookRadPerUnit;
            camera.pitchRad += dy * camera.lookRadPerUnit * SCREEN_UNIT_WIDTH_PER_HEIGHT;
            camera.pitchRad = Math.max(-pitchLimit, Math.min(pitchLimit, camera.pitchRad));
            rotation.xyzw = cameraRotationOf(camera, this._eulerScratch);
        });
    }

    private zoom(change: FieldOfViewChange): void {
        this._zoomCameras.stream({read: {camera: FlyCamera}, write: {fieldOfView: FieldOfView}}, INCLUDING_DISABLED).consume(({camera, fieldOfView}) => {
            change(fieldOfView, camera);
        });
    }
}
