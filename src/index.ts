import {
    Component,
    Entity,
    EntityCommandBufferSystem,
    System,
    DebugWorld
} from "./js_engine";
import {keyboardInput} from "./js_engine/input";

import {Camera, HudElement, RenderBounds, RenderingSystemGroup} from "./js_engine/rendering";

import {LocalPosition, LocalToWorld, Parent} from "./js_engine/translation";

import {
    Ansi,
    ConsoleHudRenderPassSystem,
    ConsoleImage,
    ConsoleImageAnchor,

} from "./js_engine/rendering/console";

import {Console2DRenderPassSystem} from "./js_engine/rendering/console/2d";
import {AverageStat} from "./js_engine/datatypes";


const world = new DebugWorld();

const buffer = world.getOrCreateSystem(EntityCommandBufferSystem).createEntityCommandBuffer()
// const buffer = world.entityManager


const cameraEntity = buffer.createEntity("cameraEntity");

buffer.addComponent(cameraEntity, new Camera());
buffer.addComponent(cameraEntity, new LocalToWorld());
const cameraPosition = buffer.addTrackedComponent(cameraEntity, new LocalPosition());
buffer.addComponent(cameraEntity, new RenderBounds());

// can share the same image instance
function createCross(position: LocalPosition, parent?: Entity, name?: string, ...additionalComponents: Component[]): [Entity, LocalPosition, Readonly<LocalToWorld>] {
    const objectEntity = buffer.createEntity(name);
    const r = Math.round(Math.random() * 255)
    const g = Math.round(Math.random() * 255)
    const b = Math.round(Math.random() * 255)
    const crossImage = new ConsoleImage();
    crossImage.transparentChar = '0'
    const color = Ansi.bgRGB(r, g, b)
    crossImage.image = [
        color + '0 0',
        color + '   ',
        color + '0 0',
    ]
    buffer.addComponent(objectEntity, crossImage);
    const localToWorld = buffer.addComponent(objectEntity, new LocalToWorld());
    if (parent) {
        buffer.addComponent(objectEntity, new Parent(parent));
    }
    for (const additionalComponent of additionalComponents) {
        buffer.addComponent(objectEntity, additionalComponent);
    }
    return [objectEntity, buffer.addTrackedComponent(objectEntity, position), localToWorld];
}

function createPixel(position: LocalPosition, parent?: Entity, name?: string, ...additionalComponents: Component[]): [Entity, LocalPosition, Readonly<LocalToWorld>] {
    const objectEntity = buffer.createEntity(name);
    const r = Math.round(Math.random() * 255)
    const g = Math.round(Math.random() * 255)
    const b = Math.round(Math.random() * 255)
    const pixelImage = new ConsoleImage();
    pixelImage.transparentChar = '0'
    const color = Ansi.bgRGB(r, g, b)
    pixelImage.image = [
        color + ' ',
    ]
    buffer.addComponent(objectEntity, pixelImage);
    const localToWorld = buffer.addComponent(objectEntity, new LocalToWorld());
    if (parent) {
        buffer.addComponent(objectEntity, new Parent(parent));
    }
    for (const additionalComponent of additionalComponents) {
        buffer.addComponent(objectEntity, additionalComponent);
    }
    return [objectEntity, buffer.addTrackedComponent(objectEntity, position), localToWorld];
}

class PlayerTag extends Component {

}

// as this entity updates at a different frequency compared to the others in the same archetype, add a component to force it to be in a different archetype
// causing only this specific entity to be updated instead of other cross entities
const [entity, position, localToWorld] = createCross(new LocalPosition(), cameraEntity, "cross1", new PlayerTag())
createCross(new LocalPosition(-5, -5), entity, "cross2")
createCross(new LocalPosition(-5, +5), entity, "cross3")
createCross(new LocalPosition(+5, -5), entity, "cross4")
createCross(new LocalPosition(+5, +5), entity, "cross5")

//hud element
// entityCounter
const entityCounterEntity = buffer.createEntity("entityCounter");
const entityCounterImage = buffer.addTrackedComponent(entityCounterEntity, new ConsoleImage());
entityCounterImage.image = [
    Ansi.colors.fg.green + 'HUD element',
]
entityCounterImage.transparentChar = undefined; // no transparency for HUD
buffer.addComponent(entityCounterEntity, new HudElement());
const anchor = new ConsoleImageAnchor()
anchor.anchorPosition = 'bottom-left';
buffer.addComponent(entityCounterEntity, anchor);
// fps counter
const fpsCounterEntity = buffer.createEntity("fpsCounter");
const fpsCounterImage = buffer.addTrackedComponent(fpsCounterEntity, new ConsoleImage());
fpsCounterImage.image = [
    Ansi.colors.fg.green + 'FPS: 0',
]
fpsCounterImage.transparentChar = undefined; // no transparency for HUD
buffer.addComponent(fpsCounterEntity, new HudElement());
const fpsAnchor = new ConsoleImageAnchor()
fpsAnchor.anchorPosition = 'top-right';
buffer.addComponent(fpsCounterEntity, fpsAnchor);


keyboardInput.when({name: 'up'}, () => {
    position.y -= 1;
})
keyboardInput.when({name: 'down'}, () => {
    position.y += 1;
})
keyboardInput.when({name: 'left'}, () => {
    position.x -= 1;
})
keyboardInput.when({name: 'right'}, () => {
    position.x += 1;
})

keyboardInput.when({name: 'w'}, () => {
    cameraPosition.y -= 1;
})
keyboardInput.when({name: 's'}, () => {
    cameraPosition.y += 1;
})
keyboardInput.when({name: 'a'}, () => {
    cameraPosition.x -= 1;
})
keyboardInput.when({name: 'd'}, () => {
    cameraPosition.x += 1;
})


keyboardInput.when({name: 'space'}, () => {
    for (let i = 0; i < 1_000; i++) {
        const x = (Math.random() - 0.5) * 100
        const y = (Math.random() - 0.5) * 100
        const newPos = new LocalPosition();
        newPos.x = x + localToWorld.position[0]
        newPos.y = y + localToWorld.position[1]
        createPixel(newPos);
    }
})
keyboardInput.when({name: 'return'}, () => {
    const renderer = world.tryGetSystem(RenderingSystemGroup);
    if (!renderer) return;
    renderer.enabled = !renderer.enabled;
    world.getOrCreateSystem(DebugSystem).logEntities();
})
keyboardInput.when({name: 'backspace'}, () => {
    const renderer = world.tryGetSystem(Console2DRenderPassSystem);
    if (!renderer) return;
    renderer.enabled = !renderer.enabled;
})
keyboardInput.when({name: 'g'}, () => {
    world.logSystemUpdateOrder();
})

keyboardInput.when({name: 'c', ctrl: true}, () => {
    world.stop()
    process.exit(0);
    // if (toggle) keyboardInput.disable();
    // else keyboardInput.enable();
    // toggle = !toggle;
})


console.log(cameraEntity)


class DebugSystem extends System {
    private _query = this.createEntityQuery([LocalToWorld])
    private _hudQuery = this.createEntityQuery([HudElement])
    private _toggle = true;
    private _fpsCounter = new AverageStat(10)

    protected onCreate() {
        // this.requireAnyForUpdate(this._query);
        // this.enabled = false;
        keyboardInput.when({name: 'tab'}, () => {
            this._toggle = !this._toggle;
            buffer.setEnabledStateForQuery(this._hudQuery, this._toggle);
            console.log("toggle hud", this._hudQuery.entityCount() + " | " + this._hudQuery.entityCountUnfiltered());
            console.log(this._hudQuery.archetypes)
        })
    }

    onUpdate() {
        if (!this._toggle) return;
        this._query.entityCount();
        // const entities = this._query
        //   .stream({}, {includeEntity: true})
        //   .collect()
        this._fpsCounter.add(1000 / this.world.time.deltaTime)
        fpsCounterImage.image = [
            Ansi.colors.fg.green + 'FPS: ' + this._fpsCounter.getAvg().toFixed(2),
        ]

        entityCounterImage.image = [
            Ansi.colors.fg.green + 'Entities: ' + (this.world.entityCount),
        ]

        // .map(e => ((e.entity as any)));
        // console.log(entities)
        // console.log("ALL");
        // console.log(this._query.entityCount());
        // console.log(this.world.entityCount)
        // this._query.stream({},{includeEntity : true}).forEach(({entity}) => {
        //   console.log((entity as any)[NAME])
        // });

        // console.log(this.world.time.deltaTime);
        // console.log(this.world.time.elapsedTime);
        // console.log(this.world.targetDeltaTime)

        // console.log(world.archetypes.totalEmpty + "/" + world.archetypes.totalCount + " empty archtypes");
    }

    public logEntities() {
        // const entities = this._query
        //     .stream({}, {includeEntity: true})
        //     .collect()
        //     // .toString()
        //     // .map(e => ((e.entity as any)[OWNER].arch as EntityArchetype).getDataAtEntity(e.entity));
        //     .forEach((e: {} & { entity: Entity }) => {
        //         console.group("DEBUG")
        //         console.log(entity);
        //         const archetype = getOwner(this.world, e.entity)!;
        //         console.log("archetype");
        //         console.log(archetype.componentTypes.map(t => t.ctor));
        //         const data = archetype.getDataAtEntity(e.entity);
        //         console.log(Array.from(data).map(([ct, value]) => value));
        //         console.groupEnd()
        //     });

        // for (const archetype of this.world.archetypes.values()) {
        //     console.log(archetype.componentTypes);
        //     console.log(archetype.entityCount + "|" + archetype.entityCountUnfiltered);
        // }

        // console.log("Entities:");
        // console.log(entities)
    }
}


world.ensureSystemExists(Console2DRenderPassSystem);
world.ensureSystemExists(ConsoleHudRenderPassSystem);

world.ensureSystemExists(DebugSystem)

world.startLoop()
