import {describe, expect, test} from "../testing/harness";
import {MemoryPlatform} from "../testing/memoryPlatform";
import {World} from "./world";
import {System} from "./system";
import {SystemGroup} from "./systemGroup";
import {PresentationSystemGroup} from "./presentationSystemGroup";
import {RootSystemGroup} from "./rootSystemGroup";
import {EntityCommandBufferSystem} from "./entityCommandBufferSystem";
import {Component} from "./component";

const TICK_DELTA_MS = 10;
const FRAME_DELTA_MS = 4;
const HALF_TICK = 0.5;
const LATE_PRESENTATION_PRIORITY = 1000;
const AFTER_PRESENTATION_PRIORITY = 2000;

class PhaseLog {
    public readonly entries: string[] = [];
}

const logs = new WeakMap<World, PhaseLog>();

function logOf(world: World): PhaseLog {
    let log = logs.get(world);
    if (log === undefined) logs.set(world, log = new PhaseLog());
    return log;
}

class Marker extends Component {
}

class SimulationProbe extends System {
    public onUpdate(): void {
        logOf(this.world).entries.push(`simulation ${this.world.time.deltaTimeMs}`);
    }
}

class ProbePresentationGroup extends PresentationSystemGroup {
    override priority(): number {
        return LATE_PRESENTATION_PRIORITY;
    }
}

class AfterPresentationProbe extends System {
    override priority(): number {
        return AFTER_PRESENTATION_PRIORITY;
    }

    public onUpdate(): void {
        logOf(this.world).entries.push("after presentation");
    }
}

class PresentationProbe extends System {
    private readonly markers = this.createEntityQuery([Marker]);

    override systemGroup() {
        return ProbePresentationGroup;
    }

    public onUpdate(): void {
        const time = this.world.time;
        logOf(this.world).entries.push(`presentation ${time.deltaTimeMs} alpha ${time.tickAlpha} markers ${this.markers.enabledEntityCount()}`);
    }
}

function phasedWorld(): World {
    const world = new World({platform: new MemoryPlatform()});
    world.ensureSystemExists(PresentationProbe);
    world.ensureSystemExists(SimulationProbe);
    return world;
}

describe("World phases", () => {
    test("step runs one simulation tick, then one presentation, each seeing its own delta", () => {
        const world = phasedWorld();
        world.step(TICK_DELTA_MS);
        expect(logOf(world).entries).toEqual([`simulation ${TICK_DELTA_MS}`, `presentation ${TICK_DELTA_MS} alpha 0 markers 0`]);
        expect([world.time.tickCount, world.time.frameCount]).toEqual([1, 1]);
        expect([world.time.tickDeltaTimeMs, world.time.frameDeltaTimeMs]).toEqual([TICK_DELTA_MS, TICK_DELTA_MS]);
    });

    test("stepSimulation runs only the simulation; renderFrame runs only the presentation with the frame delta", () => {
        const world = phasedWorld();
        world.stepSimulation(TICK_DELTA_MS);
        world.renderFrame(FRAME_DELTA_MS, HALF_TICK);
        expect(logOf(world).entries).toEqual([`simulation ${TICK_DELTA_MS}`, `presentation ${FRAME_DELTA_MS} alpha ${HALF_TICK} markers 0`]);
        expect([world.time.tickCount, world.time.frameCount]).toEqual([1, 1]);
        expect(world.time.frameDeltaTimeMs).toBe(FRAME_DELTA_MS);
        expect(world.time.deltaTimeMs).toBe(TICK_DELTA_MS);
    });

    test("step presents before the systems ordered after the presentation, so its own commands are played back when it returns", () => {
        const world = phasedWorld();
        world.ensureSystemExists(AfterPresentationProbe);
        const buffer = world.getOrCreateSystem(EntityCommandBufferSystem).getEntityCommandBuffer();
        const marked = buffer.createEntity("marked", [new Marker()]);
        world.step(TICK_DELTA_MS);
        expect(logOf(world).entries).toEqual([`simulation ${TICK_DELTA_MS}`, `presentation ${TICK_DELTA_MS} alpha 0 markers 0`, "after presentation"]);
        expect(world.entityManager.exists(marked)).toBe(true);
        world.step(TICK_DELTA_MS);
        expect(logOf(world).entries[4]).toBe(`presentation ${TICK_DELTA_MS} alpha 0 markers 1`);
    });

    test("a simulation tick on its own starts with the systems ordered after the presentation, so a following frame sees their work", () => {
        const world = phasedWorld();
        world.ensureSystemExists(AfterPresentationProbe);
        world.getOrCreateSystem(EntityCommandBufferSystem).getEntityCommandBuffer().createEntity("marked", [new Marker()]);
        world.stepSimulation(TICK_DELTA_MS);
        world.renderFrame(FRAME_DELTA_MS);
        expect(logOf(world).entries).toEqual(["after presentation", `simulation ${TICK_DELTA_MS}`, `presentation ${FRAME_DELTA_MS} alpha 0 markers 1`]);
    });

    test("updating the root group directly runs in the same order as step", () => {
        const world = phasedWorld();
        world.ensureSystemExists(AfterPresentationProbe);
        world.getOrCreateSystem(RootSystemGroup).update();
        expect(logOf(world).entries.map(entry => entry.split(" ")[0])).toEqual(["simulation", "presentation", "after"]);
    });

    test("a disabled root group runs neither phase", () => {
        const world = phasedWorld();
        world.getOrCreateSystem(RootSystemGroup).enabled = false;
        world.step(TICK_DELTA_MS);
        expect(logOf(world).entries).toEqual([]);
    });

    test("a presentation group nested in a simulation group runs with the simulation", () => {
        class OuterSimulationGroup extends SystemGroup {
        }

        class NestedPresentationGroup extends PresentationSystemGroup {
            override systemGroup() {
                return OuterSimulationGroup;
            }
        }

        class NestedProbe extends System {
            override systemGroup() {
                return NestedPresentationGroup;
            }

            public onUpdate(): void {
                logOf(this.world).entries.push("nested");
            }
        }

        const world = phasedWorld();
        world.ensureSystemExists(NestedProbe);
        world.stepSimulation(TICK_DELTA_MS);
        expect(logOf(world).entries).toEqual([`simulation ${TICK_DELTA_MS}`, "nested"]);
    });
});
