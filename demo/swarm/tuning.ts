import {Resource} from "@jsengine/engine/core";
import {TextColor} from "@jsengine/engine/rendering";
import type {Int, PrefabAsset, Rgb, TextLines} from "@jsengine/engine/scene";

export const MS_PER_SECOND = 1000;
export const SWARM_TUNING_FILE = "assets/swarm.tuning.asset.json";

const UNCAPPED = Number.POSITIVE_INFINITY;

export class WaveCurve {
    public base = 0;
    public perWave = 0;
    public perWaveSquared = 0;
    public max = UNCAPPED;

    public valueAt(wavesAfterFirst: number): number {
        return Math.min(this.max, this.base + this.perWave * wavesAfterFirst + this.perWaveSquared * wavesAfterFirst * wavesAfterFirst);
    }
}

export class ShipTuning {
    public startLives: Int = 0;
    public startInvulnerabilityMs = 0;
    public speedUnitsPerSecond = 0;
    public radiusUnits = 0;
    public invulnerabilityMs = 0;
    public blinkIntervalMs = 0;
}

export class WeaponTuning {
    public bullet: PrefabAsset | undefined = undefined;
    public fireRateShotsPerSecond = 0;
    public bulletSpeedUnitsPerSecond = 0;
}

export class BombTuning {
    public startBombs: Int = 0;
    public radiusUnits = 0;
    public sparkCount: Int = 0;
    public earnedEveryWaves: Int = 0;
    public maxBombs: Int = 0;
}

export class SparkTuning {
    public prefab: PrefabAsset | undefined = undefined;
    public minLifetimeMs = 0;
    public maxLifetimeMs = 0;
    public minReachFraction = 0;
    public maxReachFraction = 0;
    public tints: Rgb[] = [];
    public lifeLostCount: Int = 0;
    public lifeLostReachUnits = 0;
    public shipDestroyedCount: Int = 0;
    public shipDestroyedReachUnits = 0;
}

export class EnemySpawn {
    public prefab: PrefabAsset | undefined = undefined;
    public spawnShare = new WaveCurve();
}

export class WaveTuning {
    public firstWave: Int = 0;
    public intermissionMs = 0;
    public maxSpawnsPerFrame: Int = 0;
    public spawnMarginUnits = 0;
    public enemyCount = new WaveCurve();
    public spawnDurationMs = new WaveCurve();
    public enemySpeedMultiplier = new WaveCurve();
    public enemySpeedJitterFraction = 0;
    public maxEnemySteerRad = 0;
    public seekStopDistanceUnits = 0;
    public enemies: EnemySpawn[] = [];
}

export class ArenaTuning {
    public fallbackWidthUnits = 0;
    public fallbackHeightUnits = 0;
    public broadphaseMarginUnits = 0;
    public broadphaseCellSizeUnits = 0;
}

export class ControlHint {
    public keys = "";
    public effect = "";
}

export class TitleBanner {
    public lines: TextLines = [];
    public controls: ControlHint[] = [];
    public controlKeyColumns: Int = 0;
    public promptLines: TextLines = [];
    public color: TextColor = TextColor.DEFAULT;
}

export class WaveBanner {
    public lines: TextLines = [];
    public bombEarnedLines: TextLines = [];
    public color: TextColor = TextColor.DEFAULT;
}

export class GameOverBanner {
    public lines: TextLines = [];
    public color: TextColor = TextColor.DEFAULT;
}

export class HudTuning {
    public statusFormat = "";
    public statsFormat = "";
    public statsRefreshMs = 0;
    public fpsAverageFrames: Int = 0;
    public panelPaddingColumns: Int = 0;
    public title = new TitleBanner();
    public wave = new WaveBanner();
    public gameOver = new GameOverBanner();
}

export class SwarmTuning extends Resource {
    public randomSeed: Int | undefined = undefined;
    public maxSimulationStepMs = 0;
    public arena = new ArenaTuning();
    public ship = new ShipTuning();
    public weapon = new WeaponTuning();
    public bomb = new BombTuning();
    public sparks = new SparkTuning();
    public waves = new WaveTuning();
    public hud = new HudTuning();
}
