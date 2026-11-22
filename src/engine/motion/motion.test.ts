import {describe, expect, test} from "../testing/harness";
import {MemoryPlatform} from "../testing/memoryPlatform";
import {World} from "../core";
import type {Entity} from "../core";
import {Vec} from "../math/types/vec";
import {LocalPosition} from "../translation/localPosition";
import {Lifetime} from "./lifetime";
import {LifetimeSystem} from "./lifetimeSystem";
import {MotionSystem} from "./motionSystem";
import {Velocity} from "./velocity";

const HALF_SECOND_MS = 500;
const CLAMPED_STEP_MS = 100;
const LIFETIME_MS = 1200;
const STEPS_BEFORE_EXPIRY = 2;

class ClampedMotionSystem extends MotionSystem {
    protected override stepMs(): number {
        return Math.min(super.stepMs(), CLAMPED_STEP_MS);
    }
}

function newWorld(): World {
    return new World({platform: new MemoryPlatform()});
}

function velocityOf(x: number, y: number, z: number): Velocity {
    const velocity = new Velocity();
    velocity.xUnitsPerSecond = x;
    velocity.yUnitsPerSecond = y;
    velocity.zUnitsPerSecond = z;
    return velocity;
}

function lifetimeOf(ms: number): Lifetime {
    const lifetime = new Lifetime();
    lifetime.durationMs = ms;
    lifetime.remainingMs = ms;
    return lifetime;
}

function positionOf(world: World, entity: Entity): number[] {
    return Vec.toArray(world.entityManager.getComponent<LocalPosition>(entity, LocalPosition)!.xyz);
}

describe("MotionSystem", () => {
    test("moves each position by its velocity over the step", () => {
        const world = newWorld();
        world.getOrCreateSystem(MotionSystem);
        const mover = world.entityManager.createEntity("mover", [new LocalPosition(1, 2, 3), velocityOf(2, -4, 8)]);
        world.step(HALF_SECOND_MS);
        expect(positionOf(world, mover)).toEqual([2, 0, 7]);
    });

    test("leaves positions without a velocity alone", () => {
        const world = newWorld();
        world.getOrCreateSystem(MotionSystem);
        world.entityManager.createEntity("mover", [new LocalPosition(), velocityOf(1, 1, 1)]);
        const still = world.entityManager.createEntity("still", [new LocalPosition(5, 5, 5)]);
        world.step(HALF_SECOND_MS);
        expect(positionOf(world, still)).toEqual([5, 5, 5]);
    });

    test("a subclass chooses the step it integrates over", () => {
        const world = newWorld();
        world.getOrCreateSystem(ClampedMotionSystem);
        const mover = world.entityManager.createEntity("mover", [new LocalPosition(), velocityOf(10, 0, 0)]);
        world.step(HALF_SECOND_MS);
        expect(positionOf(world, mover)).toEqual([1, 0, 0]);
    });
});

describe("LifetimeSystem", () => {
    test("counts down and destroys an entity once its lifetime runs out", () => {
        const world = newWorld();
        world.getOrCreateSystem(LifetimeSystem);
        const expiring = world.entityManager.createEntity("expiring", [lifetimeOf(LIFETIME_MS)]);
        for (let step = 0; step < STEPS_BEFORE_EXPIRY; step++) world.step(HALF_SECOND_MS);
        expect(world.entityManager.exists(expiring)).toBe(true);
        expect(world.entityManager.getComponent<Lifetime>(expiring, Lifetime)!.remainingMs).toBe(LIFETIME_MS - STEPS_BEFORE_EXPIRY * HALF_SECOND_MS);
        world.step(HALF_SECOND_MS);
        expect(world.entityManager.exists(expiring)).toBe(false);
    });
});
