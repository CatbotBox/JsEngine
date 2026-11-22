import {Component} from "../../core/component";

const DEFAULT_MOVE_STEP_UNITS = 0.05;
const DEFAULT_LOOK_RAD_PER_UNIT = 0.03;
const DEFAULT_PITCH_MARGIN_RAD = 0.01;
const DEFAULT_FOV_KEY_STEP = 1.01;
const DEFAULT_FOV_WHEEL_STEP = 1.05;
const DEFAULT_MIN_FOV_DEGREES = 10;
const DEFAULT_MAX_FOV_DEGREES = 120;

export class FlyCamera extends Component {
    public yawRad = 0;
    public pitchRad = 0;
    public moveStepUnits = DEFAULT_MOVE_STEP_UNITS;
    public lookRadPerUnit = DEFAULT_LOOK_RAD_PER_UNIT;
    public pitchMarginRad = DEFAULT_PITCH_MARGIN_RAD;
    public fovKeyStep = DEFAULT_FOV_KEY_STEP;
    public fovWheelStep = DEFAULT_FOV_WHEEL_STEP;
    public minFovDegrees = DEFAULT_MIN_FOV_DEGREES;
    public maxFovDegrees = DEFAULT_MAX_FOV_DEGREES;
}
