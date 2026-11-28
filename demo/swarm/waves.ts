import {System} from "@jsengine/engine/core";
import type {EntityCommandBuffer} from "@jsengine/engine/core";
import {LocalPosition} from "@jsengine/engine/translation";
import {PrefabSpawner} from "@jsengine/engine/scene";
import {Enemy} from "./components";
import {SEEK_PRIORITY, WAVE_PRIORITY} from "./frameOrder";
import {SwarmPhase, SwarmState} from "./resources";
import {
    commandBufferOf,
    ENEMY_PREFAB_FIELD,
    fullExtentOf,
    POSITION_STRIDE,
    POSITION_X,
    POSITION_Y,
    randomOf,
    requirePrefab,
    simulationStepMs,
    SwarmArena,
} from "./simulation";
import {MS_PER_SECOND, SWARM_CONFIG_FILE, SwarmConfig} from "./config";
import type {EnemySpawn, WaveConfig} from "./config";

const UNSCALED = 1;

function enemySpawnFor(enemies: readonly EnemySpawn[], wavesAfterFirst: number, roll: number): EnemySpawn {
    if (enemies.length === 0) throw new Error(`SwarmConfig.waves.enemies is empty: list at least one enemy prefab in ${SWARM_CONFIG_FILE}`);
    let cumulativeShare = 0;
    for (const enemy of enemies) {
        cumulativeShare += enemy.spawnShare.valueAt(wavesAfterFirst);
        if (roll < cumulativeShare) return enemy;
    }
    return enemies[enemies.length - 1];
}

export class WaveSystem extends System {
    private _enemies = this.createEntityQuery([Enemy]);

    override priority(): number {
        return WAVE_PRIORITY;
    }

    protected onCreate(): void {
        this.requireResourceForUpdate(SwarmState);
        this.requireResourceForUpdate(SwarmConfig);
        this.requireResourceForUpdate(SwarmArena);
    }

    onUpdate(): void {
        const state = this.world.resources.get(SwarmState);
        if (state.phase !== SwarmPhase.Playing) return;
        const config = this.world.resources.get(SwarmConfig);
        const waves = config.waves;
        const stepMs = simulationStepMs(this.world);
        if (state.intermissionRemainingMs > 0) {
            state.intermissionRemainingMs -= stepMs;
            if (state.intermissionRemainingMs > 0) return;
            this.beginWave(state, waves);
        }
        if (state.waveEnemiesSpawned >= state.waveEnemyTarget) {
            if (this._enemies.enabledEntityCount() === 0) this.clearWave(state, config);
            return;
        }
        state.spawnBudget += stepMs * state.waveEnemyTarget / waves.spawnDurationMs.valueAt(state.wave - waves.firstWave);
        const spawns = Math.min(Math.floor(state.spawnBudget), state.waveEnemyTarget - state.waveEnemiesSpawned, waves.maxSpawnsPerFrame);
        const buffer = commandBufferOf(this.world);
        for (let i = 0; i < spawns; i++) this.spawnEnemy(state, waves, buffer);
        state.spawnBudget -= spawns;
        state.waveEnemiesSpawned += spawns;
    }

    private beginWave(state: SwarmState, waves: WaveConfig): void {
        state.intermissionRemainingMs = 0;
        state.waveEnemyTarget = waves.enemyCount.valueAt(state.wave - waves.firstWave);
        state.waveEnemiesSpawned = 0;
        state.spawnBudget = 0;
    }

    private clearWave(state: SwarmState, config: SwarmConfig): void {
        const clearedWave = state.wave;
        const earnedBomb = clearedWave % config.bomb.earnedEveryWaves === 0 && state.bombs < config.bomb.maxBombs;
        if (earnedBomb) state.bombs++;
        state.lastClearEarnedBomb = earnedBomb;
        state.wave = clearedWave + 1;
        state.intermissionRemainingMs = config.waves.intermissionMs;
        state.waveEnemyTarget = 0;
        state.waveEnemiesSpawned = 0;
        state.spawnBudget = 0;
    }

    private spawnEnemy(state: SwarmState, waves: WaveConfig, buffer: EntityCommandBuffer): void {
        const random = randomOf(this.world), arena = this.world.resources.get(SwarmArena);
        const wavesAfterFirst = state.wave - waves.firstWave;
        const kind = enemySpawnFor(waves.enemies, wavesAfterFirst, random.next());
        const halfWidth = arena.halfWidthUnits + waves.spawnMarginUnits;
        const halfHeight = arena.halfHeightUnits + waves.spawnMarginUnits;
        const width = fullExtentOf(halfWidth), height = fullExtentOf(halfHeight);
        const topEnd = width, rightEnd = topEnd + height, bottomEnd = rightEnd + width;
        const along = random.next() * (bottomEnd + height);
        let x: number, y: number;
        if (along < topEnd) {
            x = along - halfWidth;
            y = -halfHeight;
        } else if (along < rightEnd) {
            x = halfWidth;
            y = along - topEnd - halfHeight;
        } else if (along < bottomEnd) {
            x = halfWidth - (along - rightEnd);
            y = halfHeight;
        } else {
            x = -halfWidth;
            y = halfHeight - (along - bottomEnd);
        }
        const speedMultiplier = waves.enemySpeedMultiplier.valueAt(wavesAfterFirst);
        const jitter = random.between(UNSCALED - waves.enemySpeedJitterFraction, UNSCALED + waves.enemySpeedJitterFraction);
        const steer = random.between(-waves.maxEnemySteerRad, waves.maxEnemySteerRad);
        const spawned = this.world.resources.get(PrefabSpawner).spawn(buffer, requirePrefab(kind.prefab, ENEMY_PREFAB_FIELD));
        const enemy = spawned.rootComponent(Enemy);
        enemy.speedUnitsPerSecond = enemy.speedUnitsPerSecond * speedMultiplier * jitter;
        enemy.steerCos = Math.cos(steer);
        enemy.steerSin = Math.sin(steer);
        const position = spawned.rootComponent(LocalPosition);
        position.x = x;
        position.y = y;
    }
}

export class EnemySeekSystem extends System {
    private _enemies = this.createEntityQuery([Enemy, LocalPosition]);

    override priority(): number {
        return SEEK_PRIORITY;
    }

    protected onCreate(): void {
        this.requireResourceForUpdate(SwarmState);
        this.requireResourceForUpdate(SwarmConfig);
        this.requireAnyForUpdate(this._enemies);
    }

    onUpdate(): void {
        const state = this.world.resources.get(SwarmState);
        if (state.phase !== SwarmPhase.Playing) return;
        const stopDistance = this.world.resources.get(SwarmConfig).waves.seekStopDistanceUnits;
        const stepSeconds = simulationStepMs(this.world) / MS_PER_SECOND;
        const targetX = state.shipX, targetY = state.shipY;
        this._enemies.stream({read: {enemy: Enemy}, write: {position: LocalPosition}}).consumeSpans(({start, end, cols, stores}) => {
            const positions = cols.position!, enemies = stores.enemy!;
            for (let i = start; i < end; i++) {
                const enemy = enemies.get(i) as Enemy;
                const p = i * POSITION_STRIDE;
                const dx = targetX - positions[p + POSITION_X];
                const dy = targetY - positions[p + POSITION_Y];
                const distance = Math.sqrt(dx * dx + dy * dy);
                if (distance <= stopDistance) continue;
                const scale = Math.min(enemy.speedUnitsPerSecond * stepSeconds, distance) / distance;
                const stepX = dx * scale, stepY = dy * scale;
                positions[p + POSITION_X] += stepX * enemy.steerCos - stepY * enemy.steerSin;
                positions[p + POSITION_Y] += stepX * enemy.steerSin + stepY * enemy.steerCos;
            }
        });
    }
}
