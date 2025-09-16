import {Component, System, World} from "./js_engine/core";
import {keyboardInput} from "./js_engine/input";
import {Camera} from "./js_engine/rendering/camera";
import {ConsoleRenderingSystem} from "./js_engine/rendering/2d/console/consoleRenderingSystem";
import {Scale} from "./js_engine/translation/scale";
import {Position} from "./js_engine/translation/position";
import {Bounds} from "./js_engine/translation/bounds";
import {ConsoleImage, ConsoleImageAnchor} from "./js_engine/rendering/2d/console/components";
import {Ansi} from "./js_engine/rendering/2d/console/ansi";
import {RootSystemGroup} from "./js_engine/core";
import {HudElement} from "./js_engine/rendering/hudElement";
import {EntityCommandBufferSystem} from "./js_engine/core/entityCommandBufferSystem";


const world = new World();

const buffer = world.getOrCreateSystem(EntityCommandBufferSystem).createEntityCommandBuffer()
// const buffer = world.entityManager


const cameraEntity = buffer.createEntity("cameraEntity");

buffer.addComponent(cameraEntity, new Camera());
buffer.addComponent(cameraEntity, new Scale());
const cameraPosition = buffer.addTrackedComponent(cameraEntity, new Position());
buffer.addComponent(cameraEntity, new Bounds());

// can share the same image instance
function createCross(position: Position, name?: string, ...additionalComponents: Component[]) {
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
    buffer.addComponent(objectEntity, crossImage.size);
    buffer.addComponent(objectEntity, new Bounds());
    buffer.addComponent(objectEntity, crossImage);
    for (const additionalComponent of additionalComponents) {
        buffer.addComponent(objectEntity, additionalComponent);
    }
    return buffer.addTrackedComponent(objectEntity, position);
}

class PlayerTag extends Component {

}

// as this entity updates at a different frequency compared to the others in the same archetype, add a component to force it to be in a different archetype
// causing only this specific entity to be updated instead of other cross entities
const position = createCross(new Position(), "cross1", PlayerTag)
createCross(new Position(5, 5), "cross2")
createCross(new Position(1, 1), "cross3")
createCross(new Position(9, 9), "cross4")


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
    console.log("up")
})
keyboardInput.when({name: 'down'}, () => {
    position.y += 1;
    console.log("down")
})
keyboardInput.when({name: 'left'}, () => {
    position.x -= 1;
    console.log("left")
})
keyboardInput.when({name: 'right'}, () => {
    position.x += 1;
    console.log("right")
})

keyboardInput.when({name: 'w'}, () => {
    cameraPosition.y -= 1;
    console.log("up")
})
keyboardInput.when({name: 's'}, () => {
    cameraPosition.y += 1;
    console.log("down")
})
keyboardInput.when({name: 'a'}, () => {
    cameraPosition.x -= 1;
    console.log("left")
})
keyboardInput.when({name: 'd'}, () => {
    cameraPosition.x += 1;
    console.log("right")
})


keyboardInput.when({name: 'space'}, () => {
    for (let i = 0; i < 1_000; i++) {
        const x = (Math.random() - 0.5) * 100
        const y = (Math.random() - 0.5) * 100
        const newPos = Component.clone(position)
        newPos.x += x;
        newPos.y += y;
        createCross(newPos);
    }
})
keyboardInput.when({name: 'return'}, () => {
    const renderer = world.tryGetSystem(ConsoleRenderingSystem);
    if (!renderer) return;
    renderer.enabled = !renderer.enabled;
    world.getOrCreateSystem(DebugSystem).logEntities();
})

keyboardInput.when({name: 'g'}, () => {
    console.log("g")
    world.tryGetSystem(RootSystemGroup)!.debug();
})

let toggle = true;
keyboardInput.when({name: 'c', ctrl: true}, () => {
    world.stop()
    process.exit(0);
    // if (toggle) keyboardInput.disable();
    // else keyboardInput.enable();
    // toggle = !toggle;
})


console.log(cameraEntity)


class DebugSystem extends System {
    private _query = this.createEntityQuery([])
    private _hudQuery = this.createEntityQuery([HudElement])
    private toggle = true;

    protected onCreate() {
        this.requireAnyForUpdate(this._query);
        // this.enabled = false;
        keyboardInput.when({name: 'tab'}, () => {
            buffer.setEnabledStateForQuery(this._hudQuery, !toggle);
            toggle = !toggle;
            console.log("toggle hud", this._hudQuery.entityCount() + " | " + this._hudQuery.entityCountUnfiltered());
            console.log(this._hudQuery.archetypes)
        })
    }

    onUpdate() {
        this._query.entityCount();
        // const entities = this._query
        //   .stream({}, {includeEntity: true})
        //   .collect()

        fpsCounterImage.image = [
            Ansi.colors.fg.green + 'FPS: ' + (Math.round((1000 / this.world.time.deltaTime) * 10) / 10),
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
        const entities = this._query
            .stream({}, {includeEntity: true})
            .collect()
            .toString()
        // .map(e => ((e.entity as any)[OWNER].arch as EntityArchetype).getDataAtEntity(e.entity));
        // .map(e => {
        //     const archetype =   ((e.entity as any)[OWNER].arch as EntityArchetype);
        //     const data = archetype.getDataAtEntity(e.entity);
        //     const enabled = archetype.isEntityEnabled(e)
        //   });
        console.log("Entities:");
        console.log(entities)
    }
}


world.getOrCreateSystem(ConsoleRenderingSystem);

world.getOrCreateSystem(DebugSystem)

world.startLoop()
