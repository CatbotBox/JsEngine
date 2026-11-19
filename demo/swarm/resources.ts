import {Resource} from "../../src/engine/core";
import type {Int} from "../../src/engine/scene";

export const SwarmPhase = {
    Title: "title",
    Starting: "starting",
    Playing: "playing",
    GameOver: "gameOver",
} as const;

export type SwarmPhase = typeof SwarmPhase[keyof typeof SwarmPhase];

export class SwarmState extends Resource {
    public phase: SwarmPhase = SwarmPhase.Title;
    public score: Int = 0;
    public kills: Int = 0;
    public wave: Int = 0;
    public lives: Int = 0;
    public bombs: Int = 0;
    public invulnerableRemainingMs = 0;
    public fireCooldownMs = 0;
    public intermissionRemainingMs = 0;
    public waveEnemyTarget: Int = 0;
    public waveEnemiesSpawned: Int = 0;
    public spawnBudget = 0;
    public lastClearEarnedBomb = false;
    public shipX = 0;
    public shipY = 0;
}
