import {describe, expect, test} from "../testing/harness";
import {MemoryPlatform} from "../testing/memoryPlatform";
import {World} from "./world";
import {System} from "./system";
import type {SystemCtor} from "./system";
import {SystemGroup} from "./systemGroup";
import {createSystems} from "./createSystems";

const LATE_PRIORITY = 10;
const EARLY_PRIORITY = -10;
const created: string[] = [];

class LateSystem extends System {
    override priority(): number {
        return LATE_PRIORITY;
    }

    protected onCreate(): void {
        created.push("LateSystem");
    }

    public onUpdate(): void {
    }
}

class EarlySystem extends System {
    override priority(): number {
        return EARLY_PRIORITY;
    }

    protected onCreate(): void {
        created.push("EarlySystem");
        this.world.getOrCreateSystem(HelperSystem);
    }

    public onUpdate(): void {
    }
}

class HelperSystem extends System {
    protected onCreate(): void {
        created.push("HelperSystem");
    }

    public onUpdate(): void {
    }
}

class GameGroup extends SystemGroup {
    protected onCreate(): void {
        created.push("GameGroup");
    }
}

class GroupedSystem extends System {
    protected override systemGroup() {
        return GameGroup;
    }

    protected onCreate(): void {
        created.push("GroupedSystem");
    }

    public onUpdate(): void {
    }
}

function freshWorld(): World {
    created.length = 0;
    return new World({platform: new MemoryPlatform()});
}

describe("createSystems", () => {
    test("creates every listed system once, in list order, and priorities decide the update order", () => {
        const world = freshWorld();
        const list: readonly SystemCtor<System>[] = [LateSystem, EarlySystem];
        createSystems(world, list);
        expect(created).toEqual(["LateSystem", "EarlySystem", "HelperSystem"]);
        const root = world.rootSystemGroup!.systems;
        expect(root.indexOf(world.tryGetSystem(EarlySystem)!)).toBeLessThan(root.indexOf(world.tryGetSystem(LateSystem)!));
    });

    test("keeps systems that already exist, including ones a listed system created in its onCreate", () => {
        const world = freshWorld();
        const helper = world.getOrCreateSystem(HelperSystem);
        createSystems(world, [EarlySystem, HelperSystem]);
        createSystems(world, [EarlySystem]);
        expect(created).toEqual(["HelperSystem", "EarlySystem"]);
        expect(world.tryGetSystem(HelperSystem)).toBe(helper);
    });

    test("a group listed after its child is the group the child already made", () => {
        const world = freshWorld();
        createSystems(world, [GroupedSystem, GameGroup]);
        expect(created).toEqual(["GameGroup", "GroupedSystem"]);
        expect(world.tryGetSystem(GameGroup)!.systems).toEqual([world.tryGetSystem(GroupedSystem)!]);
    });
});
