import {Quaternions} from "../math/quaternions";
import {Vec} from "../math/types/vec";
import type {EulerAngles} from "./eulerAngles";
import type {LocalRotation} from "./localRotation";

const NO_TURN_RAD = 0;

export function turnEulerAngles(euler: EulerAngles, rotation: LocalRotation, pitchRad: number, yawRad: number): void {
    if (pitchRad !== NO_TURN_RAD) Vec.setX(euler.radians, Vec.x(euler.radians) + pitchRad);
    if (yawRad !== NO_TURN_RAD) Vec.setY(euler.radians, Vec.y(euler.radians) + yawRad);
    rotation.xyzw = Quaternions.eulerToQuat(euler.radians);
}
