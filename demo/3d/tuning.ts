import {Resource} from "../../src/engine/core";
import type {ShaderSource} from "../../src/engine/rendering";
import type {Int, PrefabAsset, TextLines} from "../../src/engine/scene";

const UNSCALED = 1;

export class ModelEntry {
    public prefab: PrefabAsset | undefined = undefined;
    public loadOnDemand = false;
}

export class CameraControlTuning {
    public moveStepUnits = 0;
    public lookRadPerUnit = 0;
    public pitchMarginRad = 0;
    public fovKeyStep = UNSCALED;
    public fovWheelStep = UNSCALED;
    public minFovDegrees = 0;
    public maxFovDegrees = 0;
}

export class ModelControlTuning {
    public rotateStepRad = 0;
    public scaleStep = UNSCALED;
}

export class RenderPacingPreset {
    public label = "";
    public renderRate = 0;
    public matchDisplay = false;
}

export class SupersamplePreset {
    public action = "";
    public x: Int = UNSCALED;
    public y: Int = UNSCALED;
}

export class SurfaceShaderChoice {
    public name = "";
    public shader: ShaderSource | undefined = undefined;
    public params: number[] = [];
    public instancePhaseParam: Int | undefined = undefined;
    public instancePhaseStepSeconds = 0;
}

export class Demo3dHudTuning {
    public rateWindowMs = 0;
    public rateDecimals: Int = 0;
    public fpsLines: TextLines = [];
    public pacingWithCpuLimitFormat = "";
    public statsLines: TextLines = [];
    public lodLevelsFormat = "";
    public lodLevelsShown: Int = 0;
    public lodLevelSeparator = "";
    public singleThreadedRasterText = "";
    public nextModelFormat = "";
    public noModelsFormat = "";
    public downloadFormat = "";
    public queuedSpawnsFormat = "";
    public downloadFailedFormat = "";
    public megabyteDecimals: Int = 0;
}

export class Demo3dTuning extends Resource {
    public models: ModelEntry[] = [];
    public camera = new CameraControlTuning();
    public modelControls = new ModelControlTuning();
    public sunRotateStepRad = 0;
    public lodBiasStepLevels: Int = 0;
    public renderPacing: RenderPacingPreset[] = [];
    public supersample: SupersamplePreset[] = [];
    public surfaceShaders: SurfaceShaderChoice[] = [];
    public hud = new Demo3dHudTuning();
}
