import {Resource} from "@jsengine/engine/core";
import type {Int, PrefabAsset} from "@jsengine/engine/scene";

export class Demo2dHudTuning {
    public fpsAverageFrames: Int = 0;
    public fpsFormat = "";
    public fpsDecimals: Int = 0;
    public entitiesFormat = "";
    public entitiesDecimals: Int = 0;
    public fadeSystemInactiveText = "";
    public presentationWindowMs = 0;
    public presentationFormat = "";
    public presentationDecimals: Int = 0;
}

export class Demo2dTuning extends Resource {
    public randomSeed: Int | undefined = undefined;
    public pixelPrefab: PrefabAsset | undefined = undefined;
    public pixelsPerSpawn: Int = 0;
    public spawnAreaUnits = 0;
    public fadeMinMs = 0;
    public fadeJitterMs = 0;
    public playerStepXUnits = 0;
    public playerStepYUnits = 0;
    public hud = new Demo2dHudTuning();
}
