import {describe, expect, test} from "../testing/harness";
import {MemoryPlatform} from "../testing/memoryPlatform";
import {ManualFrameScheduler} from "../testing/manualFrameScheduler";
import {Component, EntityCommandBufferSystem, Resource, System, World} from "../core";
import type {Entity} from "../core";
import {asFloat32Array, Vec3} from "../math/types/vec";
import {MAT4_TRANSLATION_X} from "../math/mat4Layout";
import {Quaternions} from "../math/quaternions";
import {InterpolatedTransform, InterpolatedTransformSnap} from "../translation/interpolatedTransform";
import {LocalPosition} from "../translation/localPosition";
import {LocalRotation} from "../translation/localRotation";
import {LocalScale} from "../translation/localScale";
import {LocalToWorld} from "../translation/localToWorld";
import {Parent} from "../translation/parent";
import {RenderingSystemGroup} from "./renderingSystemGroup";

const MS_PER_SECOND = 1000;
const TICK_RATE = 60;
const TICK_MS = MS_PER_SECOND / TICK_RATE;
const FRAME_MS = 4;
const QUARTER_TICK = 0.25;
const HALF_TICK = 0.5;
const THREE_QUARTER_TICK = 0.75;
const BEFORE_TRANSLATION_PRIORITY = -50;
const AFTER_TRANSLATION_PRIORITY = 500;
const LONG_WORK_MS = 20;
const SLOW_TICK = 2;
const STEP_X = 10;
const POSITION_DIGITS = 4;
const SPAWN_X = 40;
const TELEPORT_X = 100;
const TICKS_PER_SCENARIO = 3;
const SHEAR_SCALE_Y = 3;
const CHILD_TURN_RADIANS = 0.5;
const INTERPOLATED = true;
const NOT_INTERPOLATED = false;

type MoveKind = "write" | "writeAndSnap" | "commandsWithSnapTag";

class Probed extends Component {
}

interface Presented {
    readonly interpolating: boolean;
    readonly x: number;
    readonly matrix: number[];
}

class PresentedFrames extends Resource {
    public readonly frames: Presented[] = [];

    public get xs(): number[] {
        return this.frames.map(frame => frame.x);
    }
}

class PendingMove extends Resource {
    public x: number | undefined;
    public kind: MoveKind = "write";
}

class PresentedTransformProbe extends System {
    private readonly probed = this.createEntityQuery([Probed, LocalToWorld]);

    override systemGroup() {
        return RenderingSystemGroup;
    }

    public onUpdate(): void {
        const frames = this.world.resources.getOrCreate(PresentedFrames).frames;
        const interpolating = this.world.time.interpolatingTicks;
        this.probed.stream({read: {localToWorld: LocalToWorld}}).consume(row => {
            const matrix = asFloat32Array(row.localToWorld.matrix);
            frames.push({interpolating, x: matrix[MAT4_TRANSLATION_X], matrix: Array.from(matrix)});
        });
    }
}

class MoveSystem extends System {
    private readonly movers = this.createEntityQuery([Probed, LocalPosition]);
    private readonly snappers = this.createEntityQuery([Probed, InterpolatedTransform]);

    override priority(): number {
        return BEFORE_TRANSLATION_PRIORITY;
    }

    public onUpdate(): void {
        const move = this.world.resources.getOrCreate(PendingMove);
        const x = move.x;
        if (x === undefined) return;
        move.x = undefined;
        if (move.kind === "commandsWithSnapTag") {
            const buffer = this.world.getOrCreateSystem(EntityCommandBufferSystem).getEntityCommandBuffer();
            this.movers.stream({read: {probed: Probed}}, {includeEntity: true}).consume(row => {
                buffer.setComponent(row.entity, new LocalPosition(x, 0, 0));
                buffer.addComponent(row.entity, new InterpolatedTransformSnap());
            });
            return;
        }
        this.movers.stream({write: {position: LocalPosition}}).consume(row => {
            row.position.x = x;
        });
        if (move.kind !== "writeAndSnap") return;
        this.snappers.stream({write: {interpolation: InterpolatedTransform}}).consume(row => {
            row.interpolation.snap();
        });
    }
}

class SlowSecondTickSystem extends System {
    override priority(): number {
        return AFTER_TRANSLATION_PRIORITY;
    }

    public onUpdate(): void {
        if (this.world.time.tickCount === SLOW_TICK) (this.world.platform as MemoryPlatform).advance(LONG_WORK_MS);
    }
}

function interpolationWorld(platform: MemoryPlatform = new MemoryPlatform()): World {
    const world = new World({platform});
    world.getOrCreateSystem(RenderingSystemGroup);
    world.ensureSystemExists(PresentedTransformProbe);
    world.ensureSystemExists(MoveSystem);
    return world;
}

function spawnMover(world: World, x: number, interpolated: boolean = INTERPOLATED): Entity {
    const components: Component[] = [new LocalPosition(x, 0, 0), new LocalToWorld(), new Probed()];
    if (interpolated) components.push(new InterpolatedTransform());
    return world.entityManager.createEntity("mover", components);
}

function moveTo(world: World, x: number, kind: MoveKind = "write"): void {
    const move = world.resources.getOrCreate(PendingMove);
    move.x = x;
    move.kind = kind;
}

function presented(world: World): PresentedFrames {
    return world.resources.getOrCreate(PresentedFrames);
}

function simulationMatrix(world: World, entity: Entity): number[] {
    return Array.from(asFloat32Array(world.entityManager.getComponent<LocalToWorld>(entity, LocalToWorld)!.matrix));
}

function teleportScenario(kind: MoveKind): number[] {
    const world = interpolationWorld();
    spawnMover(world, 0);
    world.stepSimulation(TICK_MS);
    moveTo(world, STEP_X);
    world.stepSimulation(TICK_MS);
    world.renderFrame(FRAME_MS, HALF_TICK);
    moveTo(world, TELEPORT_X, kind);
    world.stepSimulation(TICK_MS);
    world.renderFrame(FRAME_MS, HALF_TICK);
    moveTo(world, TELEPORT_X + STEP_X);
    world.stepSimulation(TICK_MS);
    world.renderFrame(FRAME_MS, HALF_TICK);
    return presented(world).xs;
}

describe("transform interpolation in presentations", () => {
    test("the first frame after a spawn draws the spawned transform, not a blend from the origin", () => {
        const world = interpolationWorld();
        spawnMover(world, SPAWN_X);
        world.stepSimulation(TICK_MS);
        world.renderFrame(FRAME_MS, HALF_TICK);
        expect(presented(world).xs).toEqual([SPAWN_X]);
    });

    test("frames between ticks blend the last two ticks by tickAlpha, and the simulation keeps its own transform", () => {
        const world = interpolationWorld();
        const mover = spawnMover(world, 0);
        world.stepSimulation(TICK_MS);
        moveTo(world, STEP_X);
        world.stepSimulation(TICK_MS);
        const simulated = simulationMatrix(world, mover);
        world.renderFrame(FRAME_MS, QUARTER_TICK);
        world.renderFrame(FRAME_MS, THREE_QUARTER_TICK);
        expect(presented(world).xs).toEqual([STEP_X * QUARTER_TICK, STEP_X * THREE_QUARTER_TICK]);
        expect(presented(world).frames.every(frame => frame.interpolating)).toBe(true);
        expect(simulationMatrix(world, mover)).toEqual(simulated);
    });

    test("a presentation while a frame's ticks run draws the current transform", () => {
        const world = interpolationWorld();
        spawnMover(world, 0);
        world.stepSimulation(TICK_MS);
        moveTo(world, STEP_X);
        world.stepSimulation(TICK_MS);
        world.presentationBarriers.listenAtSystemBoundaries(() => undefined);
        world.renderFrame(FRAME_MS, HALF_TICK);
        world.presentationBarriers.listenAtSystemBoundaries(undefined);
        world.renderFrame(FRAME_MS, HALF_TICK);
        expect(presented(world).frames.map(frame => [frame.interpolating, frame.x])).toEqual([[false, STEP_X], [true, STEP_X * HALF_TICK]]);
    });

    test("the loop blends its end-of-frame presentations and draws a mid-tick one as the tick left it", () => {
        const scheduler = new ManualFrameScheduler();
        const platform = new MemoryPlatform({frameScheduler: scheduler});
        const world = interpolationWorld(platform);
        world.ensureSystemExists(SlowSecondTickSystem);
        spawnMover(world, 0);
        world.startLoop();
        moveTo(world, STEP_X);
        platform.setNow(TICK_MS);
        scheduler.frame(TICK_MS);
        moveTo(world, 2 * STEP_X);
        const halfwayIntoThirdTickMs = (2 + HALF_TICK) * TICK_MS;
        platform.setNow(halfwayIntoThirdTickMs);
        scheduler.frame(halfwayIntoThirdTickMs);
        world.pause();
        const frames = presented(world).frames;
        expect(frames.map(frame => frame.interpolating)).toEqual([true, false, true]);
        expect(frames[0].x).toBe(STEP_X);
        expect(frames[1].x).toBe(2 * STEP_X);
        expect(frames[2].x).toBeCloseTo(STEP_X + STEP_X * HALF_TICK, POSITION_DIGITS);
    });

    test("step draws the current tick, exactly as a world without interpolation does", () => {
        const run = (interpolated: boolean): Presented[] => {
            const world = interpolationWorld();
            spawnMover(world, 0, interpolated);
            for (let tick = 1; tick <= TICKS_PER_SCENARIO; tick++) {
                moveTo(world, tick * STEP_X);
                world.step(TICK_MS);
            }
            return presented(world).frames;
        };
        const interpolatedFrames = run(INTERPOLATED);
        expect(interpolatedFrames).toEqual(run(NOT_INTERPOLATED));
        expect(interpolatedFrames.map(frame => [frame.interpolating, frame.x])).toEqual([[false, STEP_X], [false, 2 * STEP_X], [false, 3 * STEP_X]]);
    });

    test("a still entity keeps its exact matrix through blended frames, even one a decomposition cannot reproduce", () => {
        const world = interpolationWorld();
        const em = world.entityManager;
        const parent = em.createEntity("stretched", [new LocalPosition(1, 2, 3), new LocalScale(1, SHEAR_SCALE_Y, 1), new LocalToWorld()]);
        const turn = new LocalRotation();
        turn.xyzw = Quaternions.eulerToQuat(Vec3.alloc(0, 0, CHILD_TURN_RADIANS));
        const child = em.createEntity("turned", [new LocalPosition(1, 0, 0), turn, new LocalToWorld(), new Parent(parent), new InterpolatedTransform(), new Probed()]);
        for (let tick = 0; tick < TICKS_PER_SCENARIO; tick++) world.stepSimulation(TICK_MS);
        world.renderFrame(FRAME_MS, HALF_TICK);
        expect(presented(world).frames[0].matrix).toEqual(simulationMatrix(world, child));
    });

    test("a transform written after its tick was captured is presented as written and left alone", () => {
        const world = interpolationWorld();
        const mover = spawnMover(world, 0);
        world.stepSimulation(TICK_MS);
        moveTo(world, STEP_X);
        world.stepSimulation(TICK_MS);
        const written = asFloat32Array(world.entityManager.getComponent<LocalToWorld>(mover, LocalToWorld)!.matrix);
        written[MAT4_TRANSLATION_X] = TELEPORT_X;
        world.renderFrame(FRAME_MS, HALF_TICK);
        expect(presented(world).xs).toEqual([TELEPORT_X]);
        expect(written[MAT4_TRANSLATION_X]).toBe(TELEPORT_X);
    });
});

describe("skipping transform interpolation", () => {
    test("a system that moves an entity and calls snap shows the destination at once, then blends from it", () => {
        expect(teleportScenario("write")).toEqual([STEP_X * HALF_TICK, (STEP_X + TELEPORT_X) * HALF_TICK, TELEPORT_X + STEP_X * HALF_TICK]);
        expect(teleportScenario("writeAndSnap")).toEqual([STEP_X * HALF_TICK, TELEPORT_X, TELEPORT_X + STEP_X * HALF_TICK]);
    });

    test("a snap tag queued through a command buffer with the move snaps the tick the move lands, then is removed", () => {
        const world = interpolationWorld();
        const mover = spawnMover(world, 0);
        world.stepSimulation(TICK_MS);
        moveTo(world, STEP_X);
        world.stepSimulation(TICK_MS);
        world.renderFrame(FRAME_MS, HALF_TICK);
        moveTo(world, TELEPORT_X, "commandsWithSnapTag");
        world.stepSimulation(TICK_MS);
        world.renderFrame(FRAME_MS, HALF_TICK);
        world.stepSimulation(TICK_MS);
        world.renderFrame(FRAME_MS, HALF_TICK);
        expect(world.entityManager.hasComponent(mover, InterpolatedTransformSnap)).toBe(true);
        moveTo(world, TELEPORT_X + STEP_X);
        world.stepSimulation(TICK_MS);
        world.renderFrame(FRAME_MS, HALF_TICK);
        expect(world.entityManager.hasComponent(mover, InterpolatedTransformSnap)).toBe(false);
        expect(presented(world).xs).toEqual([STEP_X * HALF_TICK, STEP_X, TELEPORT_X, TELEPORT_X + STEP_X * HALF_TICK]);
    });

    test("turning interpolation off draws the simulation's transform; turning it back on blends at once from the kept history", () => {
        const world = interpolationWorld();
        const mover = spawnMover(world, 0);
        world.stepSimulation(TICK_MS);
        moveTo(world, STEP_X);
        world.stepSimulation(TICK_MS);
        const interpolation = world.entityManager.getComponent<InterpolatedTransform>(mover, InterpolatedTransform)!;
        interpolation.enabled = false;
        world.renderFrame(FRAME_MS, HALF_TICK);
        interpolation.enabled = true;
        world.renderFrame(FRAME_MS, HALF_TICK);
        expect(presented(world).xs).toEqual([STEP_X, STEP_X * HALF_TICK]);
    });

    test("an entity enabled again where it was moved is not blended from where it was disabled", () => {
        const world = interpolationWorld();
        const mover = spawnMover(world, 0);
        world.stepSimulation(TICK_MS);
        moveTo(world, STEP_X);
        world.stepSimulation(TICK_MS);
        world.entityManager.setEnabledState(mover, false);
        world.stepSimulation(TICK_MS);
        world.entityManager.setEnabledState(mover, true);
        moveTo(world, TELEPORT_X);
        world.stepSimulation(TICK_MS);
        world.renderFrame(FRAME_MS, HALF_TICK);
        expect(presented(world).xs).toEqual([TELEPORT_X]);
    });
});
