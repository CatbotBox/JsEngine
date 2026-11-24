import {beforeEach, describe, expect, test} from "../testing/harness";
import {MemoryPlatform} from "../testing/memoryPlatform";
import {World} from "./world";
import {Component} from "./component";
import type {ComponentCtor} from "./component";
import {Entity} from "./entity";
import {EntityManager} from "./entityManager";
import {EntityQuery} from "./entityQuery";
import {EntityCommandBufferSystem} from "./entityCommandBufferSystem";
import type {EntityCommandBuffer} from "./entityCommandBuffer";
import {Resource} from "./resource";
import type {ResourceCtor} from "./resource";
import {System} from "./system";
import type {SystemCtor} from "./system";
import {SystemGroup} from "./systemGroup";
import {PresentationSystemGroup} from "./presentationSystemGroup";
import {Mulberry32Random} from "../math/randomSource";
import type {RandomSource} from "../math/randomSource";

const FIRST = 1;
const SECOND = 2;
const THIRD = 3;
const FOURTH = 4;
const SAME_PRIORITY = 5;
const MIDDLE_PRIORITY = 5;
const BEFORE_MIDDLE_PRIORITY = 1;
const AFTER_MIDDLE_PRIORITY = 9;
const PRESENTATION_PRIORITY = 1000;
const BETWEEN_PRESENTATION_AND_AFTER_PRIORITY = 1500;
const AFTER_PRESENTATION_PRIORITY = 2000;
const LAST_PRIORITY = Number.POSITIVE_INFINITY;
const FRAME_MS = 16;
const ENABLED = true;
const DISABLED = false;

class Position extends Component {
}

class Velocity extends Component {
}

class Marker extends Component {
}

class Lens extends Component {
}

type Types = readonly ComponentCtor<Component>[];
type GroupCtor = SystemCtor<SystemGroup>;

interface ProbeOptions {
    readonly priority?: number;
    readonly group?: () => GroupCtor;
    readonly any?: readonly Types[];
    readonly all?: readonly Types[];
    readonly run?: (world: World) => void;
}

function requireFromOptions(options: ProbeOptions, requireAny: (types: Types) => void, requireAllOf: (types: Types) => void): void {
    for (const types of options.any ?? []) requireAny(types);
    for (const types of options.all ?? []) requireAllOf(types);
}

function probe(log: string[], name: string, options: ProbeOptions = {}): SystemCtor<System> {
    return class extends System {
        override priority(): number {
            return options.priority ?? FIRST;
        }

        override systemGroup(): GroupCtor | undefined {
            return options.group?.();
        }

        protected override onCreate(): void {
            requireFromOptions(options, types => this.requireAnyForUpdate(types), types => this.requireAllForUpdate(types));
        }

        onUpdate(): void {
            log.push(name);
            options.run?.(this.world);
        }
    };
}

function probeGroup(log: string[], name: string, options: ProbeOptions = {}): GroupCtor {
    return class extends SystemGroup {
        override priority(): number {
            return options.priority ?? FIRST;
        }

        override systemGroup(): GroupCtor | undefined {
            return options.group?.();
        }

        protected override onCreate(): void {
            requireFromOptions(options, types => this.requireAnyForUpdate(types), types => this.requireAllForUpdate(types));
        }

        override onUpdate(): void {
            log.push(name);
            super.onUpdate();
        }
    };
}

function probePresentationGroup(log: string[], name: string, options: ProbeOptions = {}): GroupCtor {
    return class extends PresentationSystemGroup {
        override priority(): number {
            return options.priority ?? PRESENTATION_PRIORITY;
        }

        protected override onCreate(): void {
            requireFromOptions(options, types => this.requireAnyForUpdate(types), types => this.requireAllForUpdate(types));
        }

        override onUpdate(): void {
            log.push(name);
            super.onUpdate();
        }
    };
}

class InspectableGroup extends SystemGroup {
    public get updateOrder(): readonly System[] {
        return this.order;
    }

    public get walkedSystems(): readonly System[] {
        return this.runningList.systems;
    }
}

function expectNoLongerReferenced(group: InspectableGroup, system: System): void {
    expect(group.systems.includes(system)).toBe(false);
    expect(group.updateOrder.includes(system)).toBe(false);
    expect(group.walkedSystems.includes(system)).toBe(false);
}

let world: World;
let em: EntityManager;
let log: string[];

beforeEach(() => {
    world = new World({platform: new MemoryPlatform()});
    em = world.entityManager;
    log = [];
});

function stepLog(): string[] {
    log.length = 0;
    world.step(FRAME_MS);
    return [...log];
}

function simulationLog(): string[] {
    log.length = 0;
    world.stepSimulation(FRAME_MS);
    return [...log];
}

function countBoundaries(): () => number {
    let boundaries = 0;
    world.presentationBarriers.listenAtSystemBoundaries(() => boundaries++);
    return () => {
        const counted = boundaries;
        boundaries = 0;
        return counted;
    };
}

function onlyEntityWith(type: ComponentCtor<Component>): Entity {
    const found = [...new EntityQuery(world, [type])];
    expect(found.length).toBe(1);
    return found[0];
}

describe("running list: enabled and requirements", () => {
    test("disabling a system takes it out of its group's walk and enabling puts it back in its place", () => {
        world.createSystem(probe(log, "a", {priority: FIRST}));
        const b = world.createSystem(probe(log, "b", {priority: SECOND}));
        world.createSystem(probe(log, "c", {priority: THIRD}));
        expect(stepLog()).toEqual(["a", "b", "c"]);

        b.enabled = false;
        expect(stepLog()).toEqual(["a", "c"]);
        expect(b.requirementsMet).toBe(true);

        b.enabled = true;
        expect(stepLog()).toEqual(["a", "b", "c"]);
    });

    test("a system idles while its requirement has no entity, after its last entity is destroyed, and resumes when one appears", () => {
        const requirer = world.createSystem(probe(log, "requirer", {all: [[Position]]}));
        expect(requirer.requirementsMet).toBe(false);
        expect(stepLog()).toEqual([]);

        const e = em.createEntity("e", [new Position()]);
        expect(requirer.requirementsMet).toBe(true);
        expect(stepLog()).toEqual(["requirer"]);

        em.destroyEntity(e);
        expect(requirer.requirementsMet).toBe(false);
        expect(stepLog()).toEqual([]);

        em.createEntity("again", [new Position()]);
        expect(stepLog()).toEqual(["requirer"]);
    });

    test("any-requirements need one occupied query, all-requirements need every one", () => {
        const anyRequirer = world.createSystem(probe(log, "any", {any: [[Position], [Velocity]]}));
        const allRequirer = world.createSystem(probe(log, "all", {all: [[Position], [Velocity]]}));
        const p = em.createEntity("p", [new Position()]);
        expect([anyRequirer.requirementsMet, allRequirer.requirementsMet]).toEqual([true, false]);
        em.createEntity("v", [new Velocity()]);
        expect([anyRequirer.requirementsMet, allRequirer.requirementsMet]).toEqual([true, true]);
        em.setEnabledState(p, DISABLED);
        expect([anyRequirer.requirementsMet, allRequirer.requirementsMet]).toEqual([true, false]);
        expect(stepLog()).toEqual(["any"]);
    });

    test("pruning an empty matching archetype keeps the system idle and it resumes on a new entity", () => {
        const requirer = world.createSystem(probe(log, "requirer", {all: [[Position]]}));
        em.destroyEntity(em.createEntity("e", [new Position(), new Velocity()]));
        expect(world.archetypes.prune()).toBeGreaterThan(0);
        expect(requirer.requirementsMet).toBe(false);
        expect(stepLog()).toEqual([]);

        em.createEntity("again", [new Position(), new Velocity()]);
        expect(stepLog()).toEqual(["requirer"]);
    });

    test("the same query required twice counts twice", () => {
        const twice = world.createSystem(class extends System {
            private readonly positions = this.createEntityQuery([Position]);

            protected override onCreate(): void {
                this.requireAllForUpdate(this.positions);
                this.requireAllForUpdate(this.positions);
                this.requireAnyForUpdate(this.positions);
                this.requireAnyForUpdate(this.positions);
            }

            onUpdate(): void {
                log.push("twice");
            }
        });
        expect(twice.requirementsMet).toBe(false);
        const e = em.createEntity("e", [new Position()]);
        expect(twice.requirementsMet).toBe(true);
        em.setEnabledState(e, DISABLED);
        expect(twice.requirementsMet).toBe(false);
        em.setEnabledState(e, ENABLED);
        expect(stepLog()).toEqual(["twice"]);
    });

    test("a requirement added during an update idles the system from that point", () => {
        let required = false;
        world.createSystem(class extends System {
            onUpdate(): void {
                log.push("late");
                if (required) return;
                required = true;
                this.requireAllForUpdate([Marker]);
            }
        });
        expect(stepLog()).toEqual(["late"]);
        expect(stepLog()).toEqual([]);
        em.createEntity("m", [new Marker()]);
        expect(stepLog()).toEqual(["late"]);
    });

    test("requiring a query created by another source throws and asks for the component types", () => {
        const worldQuery = new EntityQuery(world, [Position], [Velocity]);
        const other = world.createSystem(class extends System {
            public readonly markers = this.createEntityQuery([Marker]);

            onUpdate(): void {
            }
        });
        expect(() => world.createSystem(class extends System {
            protected override onCreate(): void {
                this.requireAllForUpdate(worldQuery);
            }

            onUpdate(): void {
            }
        })).toThrow(/requireAllForUpdate: the query \(include \[Position\], exclude \[Velocity\]\) was created by World, not by this system; pass its component types to requireAllForUpdate instead/);
        expect(() => world.createSystem(class extends System {
            protected override onCreate(): void {
                this.requireAnyForUpdate(other.markers);
            }

            onUpdate(): void {
            }
        })).toThrow(/requireAnyForUpdate: the query \(include \[Marker\], exclude \[\]\) was created by .*, not by this system/);
    });
});

class Setup extends Resource {
}

class OtherSetup extends Resource {
}

class Tuning extends Resource {
}

function resourceRequirer(name: string, required: readonly ResourceCtor<Resource>[]): SystemCtor<System> {
    return class extends System {
        protected override onCreate(): void {
            for (const ctor of required) this.requireResourceForUpdate(ctor);
        }

        onUpdate(): void {
            log.push(name);
        }
    };
}

describe("running list: resource requirements", () => {
    test("a system idles while a required resource is missing and resumes when it is inserted", () => {
        const requirer = world.createSystem(resourceRequirer("requirer", [Setup, Tuning]));
        expect(requirer.requirementsMet).toBe(false);
        expect(stepLog()).toEqual([]);

        world.resources.insert(new Setup());
        expect(stepLog()).toEqual([]);
        world.resources.getOrCreate(Tuning);
        expect(stepLog()).toEqual(["requirer"]);

        world.resources.insert(new Setup());
        expect(stepLog()).toEqual(["requirer"]);
        world.resources.remove(Setup);
        expect(requirer.requirementsMet).toBe(false);
        expect(stepLog()).toEqual([]);
        world.resources.insert(new Setup());
        expect(stepLog()).toEqual(["requirer"]);
    });

    test("a resource present at registration counts as satisfied, and one required twice counts twice", () => {
        world.resources.insert(new Setup());
        const requirer = world.createSystem(resourceRequirer("requirer", [Setup, Setup]));
        expect(stepLog()).toEqual(["requirer"]);
        world.resources.remove(Setup);
        expect(requirer.requirementsMet).toBe(false);
        world.resources.insert(new Setup());
        expect(requirer.requirementsMet).toBe(true);
    });

    test("a destroyed system stops listening to its required resources", () => {
        const ctor = resourceRequirer("requirer", [Setup, Tuning]);
        const requirer = world.createSystem(ctor);
        expect(world.resources.listenerCount(Setup)).toBe(1);
        world.removeSystem(ctor);
        expect(world.resources.listenerCount(Setup)).toBe(0);
        expect(world.resources.listenerCount(Tuning)).toBe(0);
        world.resources.insert(new Setup());
        world.resources.remove(Setup);
        expect(requirer.requirementsMet).toBe(true);
    });

    test("a resource inserted by an earlier system wakes a later one in the same pass", () => {
        world.createSystem(probe(log, "loader", {priority: FIRST, run: current => current.resources.getOrCreate(Setup)}));
        world.createSystem(class extends System {
            override priority(): number {
                return SECOND;
            }

            protected override onCreate(): void {
                this.requireResourceForUpdate(Setup);
            }

            onUpdate(): void {
                log.push("needs setup");
            }
        });
        expect(stepLog()).toEqual(["loader", "needs setup"]);
    });
});

function queryOrResourceRequirer(name: string): SystemCtor<System> {
    return class extends System {
        private readonly lenses = this.createEntityQuery([Lens]);

        protected override onCreate(): void {
            this.requireQueryOrResourceForUpdate(this.lenses, Setup);
            this.requireAllForUpdate([Marker]);
        }

        onUpdate(): void {
            log.push(name);
        }
    };
}

describe("running list: query-or-resource requirements", () => {
    test("a system runs while its query is occupied or its resource is present, and its other requirements still hold", () => {
        const requirer = world.createSystem(queryOrResourceRequirer("requirer"));
        em.createEntity("marker", [new Marker()]);
        expect(requirer.requirementsMet).toBe(false);
        expect(stepLog()).toEqual([]);

        world.resources.insert(new Setup());
        expect(stepLog()).toEqual(["requirer"]);
        const lens = em.createEntity("lens", [new Lens()]);
        world.resources.remove(Setup);
        expect(stepLog()).toEqual(["requirer"]);
        em.setEnabledState(lens, DISABLED);
        expect(requirer.requirementsMet).toBe(false);
        expect(stepLog()).toEqual([]);

        world.resources.insert(new Setup());
        em.setEnabledState(lens, ENABLED);
        world.resources.remove(Setup);
        expect(stepLog()).toEqual(["requirer"]);
        em.destroyEntity(lens);
        expect(stepLog()).toEqual([]);
    });

    test("an occupied query or a present resource at registration counts as satisfied", () => {
        world.resources.insert(new Setup());
        em.createEntity("marker", [new Marker()]);
        const fromResource = world.createSystem(queryOrResourceRequirer("from resource"));
        expect(fromResource.requirementsMet).toBe(true);
        world.resources.remove(Setup);
        em.createEntity("lens", [new Lens()]);
        expect(fromResource.requirementsMet).toBe(true);
    });

    test("with several resources any one present satisfies it, and it stays satisfied while another is swapped out", () => {
        const requirer = world.createSystem(class extends System {
            private readonly lenses = this.createEntityQuery([Lens]);

            protected override onCreate(): void {
                this.requireQueryOrResourceForUpdate(this.lenses, Setup, OtherSetup);
            }

            onUpdate(): void {
                log.push("either");
            }
        });
        expect(requirer.requirementsMet).toBe(false);
        world.resources.insert(new OtherSetup());
        expect(stepLog()).toEqual(["either"]);
        world.resources.insert(new Setup());
        world.resources.remove(OtherSetup);
        expect(requirer.requirementsMet).toBe(true);
        world.resources.remove(Setup);
        expect(requirer.requirementsMet).toBe(false);
        expect(world.resources.listenerCount(OtherSetup)).toBe(1);
    });

    test("a destroyed system stops watching its query and resource", () => {
        const ctor = queryOrResourceRequirer("requirer");
        const requirer = world.createSystem(ctor);
        expect(world.resources.listenerCount(Setup)).toBe(1);
        world.removeSystem(ctor);
        expect(world.resources.listenerCount(Setup)).toBe(0);
        world.resources.insert(new Setup());
        em.createEntity("lens", [new Lens()]);
        expect(requirer.requirementsMet).toBe(true);
    });

    test("a query made by another system is refused", () => {
        const other = world.createSystem(class extends System {
            public readonly lenses = this.createEntityQuery([Lens]);

            onUpdate(): void {
            }
        });
        expect(() => world.createSystem(class extends System {
            protected override onCreate(): void {
                this.requireQueryOrResourceForUpdate(other.lenses, Setup);
            }

            onUpdate(): void {
            }
        })).toThrow(/requireQueryOrResourceForUpdate: the query \(include \[Lens\], exclude \[\]\) was created by .*, not by this system/);
    });
});

describe("running list: groups", () => {
    test("a disabled group keeps its children's state, is not updated, and resumes with them", () => {
        const Group = probeGroup(log, "group", {priority: SECOND});
        world.createSystem(probe(log, "before", {priority: FIRST}));
        const requirer = world.createSystem(probe(log, "requirer", {group: () => Group, priority: FIRST, all: [[Position]]}));
        const plain = world.createSystem(probe(log, "plain", {group: () => Group, priority: SECOND}));
        const group = world.tryGetSystem(Group)!;
        expect(stepLog()).toEqual(["before", "group", "plain"]);

        group.enabled = false;
        expect(stepLog()).toEqual(["before"]);
        em.createEntity("p", [new Position()]);
        plain.enabled = false;
        expect(requirer.requirementsMet).toBe(true);
        expect(stepLog()).toEqual(["before"]);

        group.enabled = true;
        expect(stepLog()).toEqual(["before", "group", "requirer"]);
        plain.enabled = true;
        expect(stepLog()).toEqual(["before", "group", "requirer", "plain"]);
    });

    test("a system destroyed inside a disabled group leaves the group's update order and walk at once", () => {
        const kept = world.createSystem(probe(log, "kept", {group: () => InspectableGroup, priority: FIRST}));
        const destroyedCtor = probe(log, "destroyed", {group: () => InspectableGroup, priority: SECOND});
        const destroyed = world.createSystem(destroyedCtor);
        const group = world.tryGetSystem(InspectableGroup)!;
        expect(stepLog()).toEqual(["kept", "destroyed"]);

        group.enabled = false;
        world.removeSystem(destroyedCtor);
        expectNoLongerReferenced(group, destroyed);
        expect(group.updateOrder.includes(kept)).toBe(true);

        group.enabled = true;
        expect(stepLog()).toEqual(["kept"]);
    });

    test("a system destroyed during its group's walk leaves the group's update order when the walk ends", () => {
        const destroyedCtor = probe(log, "destroyed", {group: () => InspectableGroup, priority: FIRST});
        const destroyed = world.createSystem(destroyedCtor);
        world.createSystem(probe(log, "destroyer", {
            group: () => InspectableGroup,
            priority: SECOND,
            run: current => {
                if (!current.hasSystem(destroyedCtor)) return;
                current.removeSystem(destroyedCtor);
                current.tryGetSystem(InspectableGroup)!.enabled = false;
            },
        }));
        world.createSystem(probe(log, "next", {group: () => InspectableGroup, priority: THIRD}));
        const group = world.tryGetSystem(InspectableGroup)!;

        expect(stepLog()).toEqual(["destroyed", "destroyer", "next"]);
        expectNoLongerReferenced(group, destroyed);
    });

    test("a group whose camera-like requirement is empty leaves its parent's walk and pays no boundary", () => {
        const Outer = probeGroup(log, "outer", {priority: FIRST});
        const Render = probeGroup(log, "render", {group: () => Outer, priority: FIRST, all: [[Lens]]});
        world.createSystem(probe(log, "drawn", {group: () => Render}));
        world.createSystem(probe(log, "sibling", {group: () => Outer, priority: SECOND}));
        const render = world.tryGetSystem(Render)!;
        const boundaries = countBoundaries();
        const rootRunning = world.rootSystemGroup!.systems.filter(system => system.enabled && system.requirementsMet).length;

        expect(render.requirementsMet).toBe(false);
        expect(simulationLog()).toEqual(["outer", "sibling"]);
        expect(boundaries()).toBe(rootRunning - 1);

        em.createEntity("lens", [new Lens()]);
        expect(simulationLog()).toEqual(["outer", "render", "drawn", "sibling"]);
        expect(boundaries()).toBe(rootRunning - 1 + 1);
    });

    test("atSystemBoundary runs once between each pair of systems that run, never for idle ones", () => {
        const Group = probeGroup(log, "group", {priority: THIRD});
        world.createSystem(probe(log, "a", {priority: FIRST}));
        world.createSystem(probe(log, "idle root", {priority: SECOND, all: [[Marker]]}));
        world.createSystem(probe(log, "x", {group: () => Group, priority: FIRST}));
        world.createSystem(probe(log, "idle child", {group: () => Group, priority: SECOND, any: [[Marker]]}));
        world.createSystem(probe(log, "y", {group: () => Group, priority: THIRD}));
        world.createSystem(probe(log, "z", {group: () => Group, priority: FOURTH}));
        const boundaries = countBoundaries();
        const rootRunning = world.rootSystemGroup!.systems.filter(system => system.enabled && system.requirementsMet).length;
        const groupRunning = 3;

        expect(simulationLog()).toEqual(["a", "group", "x", "y", "z"]);
        expect(boundaries()).toBe(rootRunning - 1 + groupRunning - 1);
    });

    test("updating a group from inside its own walk throws and the group still walks afterwards", () => {
        const Group = probeGroup(log, "group", {priority: FIRST});
        let reenter = true;
        world.createSystem(probe(log, "reentrant", {
            group: () => Group,
            run: current => {
                if (reenter) current.tryGetSystem(Group)!.update();
            },
        }));
        expect(() => world.step(FRAME_MS)).toThrow(/updated again while it was updating its systems/);
        reenter = false;
        expect(stepLog()).toEqual(["group", "reentrant"]);
    });
});

describe("running list: changes during a walk", () => {
    test("command buffer playback makes a later system runnable in the same pass", () => {
        world.getOrCreateSystem(EntityCommandBufferSystem);
        world.createSystem(probe(log, "spawner", {
            run: current => {
                if (current.time.tickCount === 1) current.getOrCreateSystem(EntityCommandBufferSystem).getEntityCommandBuffer().createEntity("m", [new Marker()]);
            },
        }));
        world.createSystem(probe(log, "after playback", {priority: LAST_PRIORITY, all: [[Marker]]}));
        expect(stepLog()).toEqual(["spawner", "after playback"]);
    });

    test("a system that idles and becomes runnable again during its own update runs once, and the next one still runs", () => {
        em.createEntity("p", [new Position()]);
        world.createSystem(probe(log, "self", {
            priority: FIRST,
            all: [[Position]],
            run: () => {
                em.destroyEntity(onlyEntityWith(Position));
                em.createEntity("p", [new Position()]);
            },
        }));
        world.createSystem(probe(log, "next", {priority: SECOND}));
        expect(stepLog()).toEqual(["self", "next"]);
        expect(stepLog()).toEqual(["self", "next"]);
    });

    test("an earlier idle system made runnable while the current one idles waits for the next pass", () => {
        em.createEntity("p", [new Position()]);
        world.createSystem(probe(log, "previous", {priority: FIRST}));
        world.createSystem(probe(log, "earlier", {priority: SECOND, all: [[Velocity]]}));
        world.createSystem(probe(log, "current", {
            priority: THIRD,
            all: [[Position]],
            run: () => {
                em.destroyEntity(onlyEntityWith(Position));
                em.createEntity("v", [new Velocity()]);
            },
        }));
        world.createSystem(probe(log, "later", {priority: FOURTH}));
        expect(stepLog()).toEqual(["previous", "current", "later"]);
        expect(stepLog()).toEqual(["previous", "earlier", "later"]);
    });

    test("an earlier idle system made runnable by the current one waits for the next pass", () => {
        world.createSystem(probe(log, "earlier", {priority: FIRST, all: [[Marker]]}));
        world.createSystem(probe(log, "current", {
            priority: SECOND,
            run: current => {
                if (current.time.tickCount === 1) em.createEntity("m", [new Marker()]);
            },
        }));
        expect(stepLog()).toEqual(["current"]);
        expect(stepLog()).toEqual(["earlier", "current"]);
    });

    test("a later system turned off and on again before the walk reaches it still runs; one turned off is skipped", () => {
        const v = em.createEntity("v", [new Velocity()]);
        const m = em.createEntity("m", [new Marker()]);
        world.createSystem(probe(log, "toggler", {
            priority: FIRST,
            run: () => {
                em.setEnabledState(v, DISABLED);
                em.setEnabledState(v, ENABLED);
                em.destroyEntity(m);
            },
        }));
        world.createSystem(probe(log, "flipped", {priority: SECOND, all: [[Velocity]]}));
        world.createSystem(probe(log, "idled", {priority: THIRD, all: [[Marker]]}));
        expect(stepLog()).toEqual(["toggler", "flipped"]);
    });

    test("a system disabling and re-enabling a later one, or disabling an earlier one, keeps the walk in order", () => {
        const earlier = world.createSystem(probe(log, "earlier", {priority: FIRST}));
        let later: System | undefined;
        world.createSystem(probe(log, "toggler", {
            priority: SECOND,
            run: () => {
                earlier.enabled = false;
                earlier.enabled = true;
                later!.enabled = false;
                later!.enabled = true;
            },
        }));
        later = world.createSystem(probe(log, "later", {priority: THIRD}));
        expect(stepLog()).toEqual(["earlier", "toggler", "later"]);
    });

    test("removing the system being updated does not skip the next one", () => {
        let selfCtor: SystemCtor<System> | undefined;
        selfCtor = probe(log, "removed", {priority: FIRST, run: current => current.removeSystem(selfCtor!)});
        world.createSystem(selfCtor);
        world.createSystem(probe(log, "next", {priority: SECOND}));
        expect(stepLog()).toEqual(["removed", "next"]);
        expect(stepLog()).toEqual(["next"]);
    });

    test("a system that removes itself and then makes a later idle system runnable lets that one run in the same pass", () => {
        let selfCtor: SystemCtor<System> | undefined;
        world.createSystem(probe(log, "previous", {priority: FIRST}));
        selfCtor = probe(log, "removed", {
            priority: SECOND,
            run: current => {
                current.removeSystem(selfCtor!);
                em.createEntity("m", [new Marker()]);
            },
        });
        world.createSystem(selfCtor);
        world.createSystem(probe(log, "woken", {priority: THIRD, all: [[Marker]]}));
        expect(stepLog()).toEqual(["previous", "removed", "woken"]);
    });

    function replacingWorld(create: (current: World, replacement: SystemCtor<System>) => void): void {
        let selfCtor: SystemCtor<System> | undefined;
        const replacement = probe(log, "replacement", {priority: SECOND});
        world.createSystem(probe(log, "previous", {priority: FIRST}));
        selfCtor = probe(log, "replaced", {
            priority: SECOND,
            run: current => {
                current.removeSystem(selfCtor!);
                create(current, replacement);
            },
        });
        world.createSystem(selfCtor);
        world.createSystem(probe(log, "next", {priority: THIRD}));
    }

    test("a system that removes itself and creates its replacement lets the replacement join from the next pass", () => {
        replacingWorld((current, replacement) => current.ensureSystemExists(replacement));
        expect(stepLog()).toEqual(["previous", "replaced", "next"]);
        expect(stepLog()).toEqual(["previous", "replacement", "next"]);
    });

    test("a replacement created with createSystemNow runs in the same pass, after the system it replaces", () => {
        replacingWorld((current, replacement) => current.createSystemNow(replacement));
        expect(stepLog()).toEqual(["previous", "replaced", "replacement", "next"]);
        expect(stepLog()).toEqual(["previous", "replacement", "next"]);
    });

    test("removing an earlier system during an update neither repeats nor skips the next one", () => {
        const earlierCtor = probe(log, "earlier", {priority: FIRST});
        world.createSystem(earlierCtor);
        world.createSystem(probe(log, "remover", {priority: SECOND, run: current => current.removeSystem(earlierCtor)}));
        world.createSystem(probe(log, "next", {priority: THIRD}));
        expect(stepLog()).toEqual(["earlier", "remover", "next"]);
        expect(stepLog()).toEqual(["remover", "next"]);
    });

    function creatingWorld(create: (current: World, created: SystemCtor<System>) => void): System[] {
        const createdCtors = [
            probe(log, "created before", {priority: BEFORE_MIDDLE_PRIORITY}),
            probe(log, "created tie", {priority: MIDDLE_PRIORITY}),
            probe(log, "created after", {priority: AFTER_MIDDLE_PRIORITY}),
        ];
        const created: System[] = [];
        world.createSystem(probe(log, "creator", {
            priority: MIDDLE_PRIORITY,
            run: current => {
                if (created.length > 0) return;
                for (const ctor of createdCtors) create(current, ctor);
                for (const ctor of createdCtors) created.push(current.tryGetSystem(ctor)!);
            },
        }));
        return created;
    }

    test("a system created during its group's update is set up at once but joins the update list on the next pass", () => {
        const created = creatingWorld((current, ctor) => current.ensureSystemExists(ctor));
        expect(stepLog()).toEqual(["creator"]);
        expect(created.length).toBe(3);
        expect(created.every(system => world.rootSystemGroup!.systems.includes(system))).toBe(true);
        expect(stepLog()).toEqual(["created before", "creator", "created tie", "created after"]);
    });

    test("a system created with createSystemNow during an update runs in that pass when it sorts after the current one, otherwise from the next", () => {
        creatingWorld((current, ctor) => current.createSystemNow(ctor));
        expect(stepLog()).toEqual(["creator", "created tie", "created after"]);
        expect(stepLog()).toEqual(["created before", "creator", "created tie", "created after"]);
    });

    test("equal priorities run in creation order, also after being disabled and enabled in another order", () => {
        const systems = ["a", "b", "c", "d"].map(name => world.createSystem(probe(log, name, {priority: SAME_PRIORITY})));
        expect(stepLog()).toEqual(["a", "b", "c", "d"]);
        for (const system of systems) system.enabled = false;
        for (const system of [...systems].reverse()) system.enabled = true;
        expect(stepLog()).toEqual(["a", "b", "c", "d"]);
    });
});

describe("running list: root presentation slot", () => {
    function slotWorld(presentation: ProbeOptions | undefined): GroupCtor | undefined {
        world.createSystem(probe(log, "before", {priority: FIRST}));
        world.createSystem(probe(log, "after", {priority: AFTER_PRESENTATION_PRIORITY}));
        if (presentation === undefined) return undefined;
        const Presentation = probePresentationGroup(log, "presentation", presentation);
        world.createSystem(probe(log, "presented", {group: () => Presentation}));
        return Presentation;
    }

    test("the split around the presentation group holds while it is idle, disabled or running", () => {
        const Presentation = slotWorld({all: [[Lens]]})!;
        expect(stepLog()).toEqual(["before", "after"]);
        expect(simulationLog()).toEqual(["after", "before"]);

        em.createEntity("lens", [new Lens()]);
        expect(stepLog()).toEqual(["before", "presentation", "presented", "after"]);
        expect(simulationLog()).toEqual(["after", "before"]);

        world.tryGetSystem(Presentation)!.enabled = false;
        expect(stepLog()).toEqual(["before", "after"]);
        expect(simulationLog()).toEqual(["after", "before"]);
    });

    test("without a presentation group the whole simulation runs in priority order", () => {
        slotWorld(undefined);
        expect(stepLog()).toEqual(["before", "after"]);
        expect(simulationLog()).toEqual(["before", "after"]);
    });

    test("a presentation group created during a root walk leaves this pass's split alone and joins on the next root update", () => {
        const Presentation = probePresentationGroup(log, "presentation");
        const presented = probe(log, "presented", {group: () => Presentation});
        world.createSystem(probe(log, "creator", {priority: FIRST, run: current => current.ensureSystemExists(presented)}));
        world.createSystem(probe(log, "middle", {priority: BETWEEN_PRESENTATION_AND_AFTER_PRIORITY}));
        world.createSystem(probe(log, "after", {priority: AFTER_PRESENTATION_PRIORITY}));

        expect(simulationLog()).toEqual(["creator", "middle", "after"]);
        expect(world.tryGetSystem(Presentation)).toBeDefined();
        expect(simulationLog()).toEqual(["middle", "after", "creator"]);
        expect(stepLog()).toEqual(["creator", "presentation", "presented", "middle", "after"]);
    });

    test("a presentation group created with createSystemNow during a root walk is presented in that step without repeating earlier systems", () => {
        const Presentation = probePresentationGroup(log, "presentation");
        const presented = probe(log, "presented", {group: () => Presentation});
        world.createSystem(probe(log, "creator", {
            priority: FIRST,
            run: current => {
                if (current.hasSystem(Presentation)) return;
                current.createSystemNow(Presentation);
                current.createSystemNow(presented);
            },
        }));
        world.createSystem(probe(log, "middle", {priority: BETWEEN_PRESENTATION_AND_AFTER_PRIORITY}));

        expect(stepLog()).toEqual(["creator", "presentation", "presented", "middle"]);
        expect(stepLog()).toEqual(["creator", "presentation", "presented", "middle"]);
    });

    test("a presentation group destroyed during a root walk leaves this pass's split alone and leaves on the next root update", () => {
        const Presentation = slotWorld({})!;
        world.createSystem(probe(log, "middle", {priority: BETWEEN_PRESENTATION_AND_AFTER_PRIORITY}));
        world.createSystem(probe(log, "destroyer", {
            priority: SECOND,
            run: current => {
                if (current.hasSystem(Presentation)) current.removeSystem(Presentation);
            },
        }));

        expect(simulationLog()).toEqual(["middle", "after", "before", "destroyer"]);
        expect(world.hasSystem(Presentation)).toBe(false);
        expect(simulationLog()).toEqual(["before", "destroyer", "middle", "after"]);
        expect(stepLog()).toEqual(["before", "destroyer", "middle", "after"]);
    });

    test("systems made runnable after the slot during a simulation tick run in it; ones before it run in the same tick after it", () => {
        world.getOrCreateSystem(EntityCommandBufferSystem);
        slotWorld({});
        world.createSystem(probe(log, "marked before", {priority: SECOND, all: [[Marker]]}));
        world.getOrCreateSystem(EntityCommandBufferSystem).getEntityCommandBuffer().createEntity("m", [new Marker()]);
        expect(simulationLog()).toEqual(["after", "before", "marked before"]);
    });
});

const EQUIVALENCE_SEED = 0x5eed;
const EQUIVALENCE_SYSTEM_COUNT = 20;
const ALWAYS_RUNNING_SYSTEM_COUNT = 3;
const INITIAL_ENTITY_COUNT = 8;
const EQUIVALENCE_TICKS = 600;
const EQUIVALENCE_PRIORITIES = [0, 1, 2, 3];
const GROUP_PRIORITY = 1;
const SCENARIO_PRESENTATION_PRIORITY = 2;
const ROOT_SHARE = 0.6;
const GROUP_SHARE = 0.25;
const ANY_QUERY_CHANCE = 0.45;
const ALL_QUERY_CHANCE = 0.45;
const SECOND_QUERY_CHANCE = 0.3;
const SECOND_COMPONENT_CHANCE = 0.4;
const EXCLUDE_CHANCE = 0.25;
const ACT_CHANCE = 0.6;
const MIN_COMPONENTS_PER_ENTITY = 1;
const MAX_EXTRA_COMPONENTS_PER_ENTITY = 2;
const STEP_EVERY_TICKS = 3;
const STEP_PHASE = 0;
const SIMULATE_PHASE = 1;
const PASSES_PER_PHASE = 2;
const PASSES_PER_SYSTEM = EQUIVALENCE_TICKS * PASSES_PER_PHASE / STEP_EVERY_TICKS;
const NO_REQUIREMENTS: readonly QuerySpec[] = [];
const TOGGLEABLE = true;
const ALWAYS_ENABLED = false;

class Alpha extends Component {
}

class Beta extends Component {
}

class Gamma extends Component {
}

class Delta extends Component {
}

class Epsilon extends Component {
}

const SCENARIO_COMPONENTS: Types = [Alpha, Beta, Gamma, Delta, Epsilon];

interface QuerySpec {
    readonly include: Types;
    readonly exclude: Types;
}

type Placement = "root" | "group" | "presentation";

interface ScenarioSystemSpec {
    readonly name: string;
    readonly priority: number;
    readonly placement: Placement;
    readonly toggleable: boolean;
    readonly any: readonly QuerySpec[];
    readonly all: readonly QuerySpec[];
}

interface ScenarioSpec {
    readonly systems: readonly ScenarioSystemSpec[];
    readonly groupAll: readonly QuerySpec[];
    readonly presentationAny: readonly QuerySpec[];
}

function pick<T>(random: RandomSource, items: readonly T[]): T {
    return items[Math.floor(random.next() * items.length)];
}

function chance(random: RandomSource, probability: number): boolean {
    return random.next() < probability;
}

function querySpec(random: RandomSource): QuerySpec {
    const first = pick(random, SCENARIO_COMPONENTS);
    const include = [first];
    if (chance(random, SECOND_COMPONENT_CHANCE)) include.push(pick(random, SCENARIO_COMPONENTS.filter(type => type !== first)));
    const excludable = SCENARIO_COMPONENTS.filter(type => !include.includes(type));
    const exclude = chance(random, EXCLUDE_CHANCE) ? [pick(random, excludable)] : [];
    return {include, exclude};
}

function querySpecs(random: RandomSource, probability: number): QuerySpec[] {
    if (!chance(random, probability)) return [];
    const specs = [querySpec(random)];
    if (chance(random, SECOND_QUERY_CHANCE)) specs.push(querySpec(random));
    return specs;
}

function placementOf(random: RandomSource): Placement {
    const roll = random.next();
    if (roll < ROOT_SHARE) return "root";
    return roll < ROOT_SHARE + GROUP_SHARE ? "group" : "presentation";
}

function scenarioSpec(seed: number): ScenarioSpec {
    const random = new Mulberry32Random(seed);
    const systems = Array.from({length: EQUIVALENCE_SYSTEM_COUNT}, (_, index): ScenarioSystemSpec => {
        const priority = pick(random, EQUIVALENCE_PRIORITIES);
        if (index < ALWAYS_RUNNING_SYSTEM_COUNT) return {name: `s${index}`, priority, placement: "root", toggleable: ALWAYS_ENABLED, any: NO_REQUIREMENTS, all: NO_REQUIREMENTS};
        return {
            name: `s${index}`,
            priority,
            placement: placementOf(random),
            toggleable: TOGGLEABLE,
            any: querySpecs(random, ANY_QUERY_CHANCE),
            all: querySpecs(random, ALL_QUERY_CHANCE),
        };
    });
    return {systems, groupAll: [querySpec(random)], presentationAny: [querySpec(random)]};
}

interface Toggleable {
    toggle(): void;
}

type ScenarioAction = (runtime: ScenarioRuntime, target: Entity | undefined, type: ComponentCtor<Component>) => void;

const SCENARIO_ACTIONS: readonly ScenarioAction[] = [
    runtime => runtime.live.push(runtime.entityManager.createEntity(undefined, runtime.components())),
    runtime => runtime.live.push(runtime.buffer.createEntity(undefined, runtime.components())),
    (runtime, target) => {
        if (target !== undefined) runtime.entityManager.destroyEntity(runtime.forget(target));
    },
    (runtime, target) => {
        if (target !== undefined) runtime.buffer.destroyEntity(runtime.forget(target));
    },
    (runtime, target) => {
        if (target !== undefined) runtime.entityManager.setEnabledState(target, !runtime.entityManager.isEnabled(target));
    },
    (runtime, target, type) => {
        if (target !== undefined && !runtime.entityManager.hasComponent(target, type)) runtime.entityManager.addComponent(target, new type());
    },
    (runtime, target, type) => {
        if (target !== undefined) runtime.entityManager.removeComponent(target, type);
    },
    runtime => pick(runtime.random, runtime.toggles).toggle(),
    runtime => runtime.world.archetypes.prune(),
];

class ScenarioRuntime {
    public readonly log: string[] = [];
    public readonly live: Entity[] = [];
    public readonly toggles: Toggleable[] = [];
    public readonly random: RandomSource;
    public tick = 0;

    public constructor(public readonly world: World, seed: number) {
        this.random = new Mulberry32Random(seed);
    }

    public get entityManager(): EntityManager {
        return this.world.entityManager;
    }

    public get buffer(): EntityCommandBuffer {
        return this.world.getOrCreateSystem(EntityCommandBufferSystem).getEntityCommandBuffer();
    }

    public record(name: string): void {
        this.log.push(`${this.tick} ${name}`);
    }

    public act(): void {
        const random = this.random;
        if (!chance(random, ACT_CHANCE)) return;
        const action = pick(random, SCENARIO_ACTIONS);
        const target = this.live.length === 0 ? undefined : pick(random, this.live);
        const type = pick(random, SCENARIO_COMPONENTS);
        action(this, target !== undefined && this.entityManager.exists(target) ? target : undefined, type);
    }

    public components(): Component[] {
        const count = MIN_COMPONENTS_PER_ENTITY + Math.floor(this.random.next() * (MAX_EXTRA_COMPONENTS_PER_ENTITY + 1));
        const types = new Set<ComponentCtor<Component>>();
        for (let i = 0; i < count; i++) types.add(pick(this.random, SCENARIO_COMPONENTS));
        return [...types].map(type => new type());
    }

    public forget(target: Entity): Entity {
        this.live.splice(this.live.indexOf(target), 1);
        return target;
    }
}

class ReferenceGate {
    public enabled = true;
    private readonly any: EntityQuery<Types, Types>[];
    private readonly all: EntityQuery<Types, Types>[];

    public constructor(world: World, any: readonly QuerySpec[], all: readonly QuerySpec[]) {
        this.any = any.map(spec => new EntityQuery(world, spec.include, spec.exclude));
        this.all = all.map(spec => new EntityQuery(world, spec.include, spec.exclude));
    }

    public open(): boolean {
        if (!this.enabled) return false;
        if (this.any.length > 0 && !this.any.some(query => query.hasEntity())) return false;
        return this.all.every(query => query.hasEntity());
    }
}

type RequirementMode = "tracked" | "checked when reached";

interface Requirer {
    requireAny(spec: QuerySpec): void;
    requireAll(spec: QuerySpec): void;
}

function scenarioWorld(spec: ScenarioSpec, mode: RequirementMode, seed: number): ScenarioRuntime {
    const runtime = new ScenarioRuntime(new World({platform: new MemoryPlatform()}), seed);
    const tracked = mode === "tracked";

    function gate(system: System & Requirer, any: readonly QuerySpec[], all: readonly QuerySpec[], toggleable: boolean): ReferenceGate | undefined {
        if (!tracked) {
            const reference = new ReferenceGate(system.world, any, all);
            if (toggleable) runtime.toggles.push({toggle: () => reference.enabled = !reference.enabled});
            return reference;
        }
        if (toggleable) runtime.toggles.push({toggle: () => system.enabled = !system.enabled});
        for (const query of any) system.requireAny(query);
        for (const query of all) system.requireAll(query);
        return undefined;
    }

    class ScenarioGroup extends SystemGroup implements Requirer {
        private reference: ReferenceGate | undefined;

        override priority(): number {
            return GROUP_PRIORITY;
        }

        public requireAny(query: QuerySpec): void {
            this.requireAnyForUpdate(query.include, query.exclude);
        }

        public requireAll(query: QuerySpec): void {
            this.requireAllForUpdate(query.include, query.exclude);
        }

        protected override onCreate(): void {
            this.reference = gate(this, NO_REQUIREMENTS, spec.groupAll, TOGGLEABLE);
        }

        override onUpdate(): void {
            if (this.reference !== undefined && !this.reference.open()) return;
            runtime.record("group");
            super.onUpdate();
        }
    }

    class ScenarioPresentation extends PresentationSystemGroup implements Requirer {
        private reference: ReferenceGate | undefined;

        override priority(): number {
            return SCENARIO_PRESENTATION_PRIORITY;
        }

        public requireAny(query: QuerySpec): void {
            this.requireAnyForUpdate(query.include, query.exclude);
        }

        public requireAll(query: QuerySpec): void {
            this.requireAllForUpdate(query.include, query.exclude);
        }

        protected override onCreate(): void {
            this.reference = gate(this, spec.presentationAny, NO_REQUIREMENTS, TOGGLEABLE);
        }

        override onUpdate(): void {
            if (this.reference !== undefined && !this.reference.open()) return;
            runtime.record("presentation");
            super.onUpdate();
        }
    }

    const groupOf: Record<Placement, GroupCtor | undefined> = {root: undefined, group: ScenarioGroup, presentation: ScenarioPresentation};
    const scenario = runtime.world;
    scenario.getOrCreateSystem(EntityCommandBufferSystem);
    scenario.getOrCreateSystem(ScenarioGroup);
    scenario.getOrCreateSystem(ScenarioPresentation);
    for (const systemSpec of spec.systems) {
        scenario.createSystem(class extends System implements Requirer {
            private reference: ReferenceGate | undefined;

            override priority(): number {
                return systemSpec.priority;
            }

            override systemGroup(): GroupCtor | undefined {
                return groupOf[systemSpec.placement];
            }

            public requireAny(query: QuerySpec): void {
                this.requireAnyForUpdate(query.include, query.exclude);
            }

            public requireAll(query: QuerySpec): void {
                this.requireAllForUpdate(query.include, query.exclude);
            }

            protected override onCreate(): void {
                this.reference = gate(this, systemSpec.any, systemSpec.all, systemSpec.toggleable);
            }

            onUpdate(): void {
                if (this.reference !== undefined && !this.reference.open()) return;
                runtime.record(systemSpec.name);
                runtime.act();
            }
        });
    }
    return runtime;
}

function runScenario(runtime: ScenarioRuntime): void {
    const scenario = runtime.world;
    for (let i = 0; i < INITIAL_ENTITY_COUNT; i++) runtime.live.push(scenario.entityManager.createEntity(undefined, runtime.components()));
    for (let tick = 0; tick < EQUIVALENCE_TICKS; tick++) {
        runtime.tick = tick;
        const phase = tick % STEP_EVERY_TICKS;
        if (phase === STEP_PHASE) scenario.step(FRAME_MS);
        else if (phase === SIMULATE_PHASE) scenario.stepSimulation(FRAME_MS);
        else scenario.renderFrame(FRAME_MS);
    }
}

function passesPerName(log: readonly string[]): Map<string, number> {
    const passes = new Map<string, number>();
    for (const entry of log) {
        const name = entry.split(" ")[1];
        passes.set(name, (passes.get(name) ?? 0) + 1);
    }
    return passes;
}

describe("running list: order equivalence", () => {
    test("tracked requirements produce the same update order as checking every system when the walk reaches it", () => {
        const spec = scenarioSpec(EQUIVALENCE_SEED);
        const tracked = scenarioWorld(spec, "tracked", EQUIVALENCE_SEED);
        const reference = scenarioWorld(spec, "checked when reached", EQUIVALENCE_SEED);
        runScenario(tracked);
        runScenario(reference);

        const passes = passesPerName(reference.log);
        const sometimesIdle = [...passes.values()].filter(count => count < PASSES_PER_SYSTEM).length;
        expect(passes.size).toBeGreaterThan(EQUIVALENCE_SYSTEM_COUNT / 2);
        expect(sometimesIdle).toBeGreaterThan(EQUIVALENCE_SYSTEM_COUNT / 4);
        expect(tracked.log.length).toBe(reference.log.length);
        expect(tracked.log).toEqual(reference.log);
        expect(tracked.world.enabledEntityCount).toBe(reference.world.enabledEntityCount);
    });
});
