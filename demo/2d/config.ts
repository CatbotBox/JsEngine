import {Resource} from "@jsengine/engine/core";
import type {Int, PrefabAsset} from "@jsengine/engine/scene";

export class Demo2dHudConfig {
    public fpsAverageFrames: Int = 0;
    public fpsFormat = "";
    public fpsDecimals: Int = 0;
    public fadingPixelsFormat = "";
    public fadeSystemInactiveText = "";
    public presentationWindowMs = 0;
    public presentationFormat = "";
    public presentationDecimals: Int = 0;
}

export class Demo2dConfig extends Resource {
    public randomSeed: Int | undefined = undefined;
    public pixelPrefab: PrefabAsset | undefined = undefined;
    public pixelsPerSpawn: Int = 0;
    public spawnAreaXUnits = 0;
    public spawnAreaYUnits = 0;
    public fadeMinMs = 0;
    public fadeJitterMs = 0;
    public playerStepXUnits = 0;
    public playerStepYUnits = 0;
    public hud = new Demo2dHudConfig();
}
