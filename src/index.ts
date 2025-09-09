import "./js_engine/debugging/consoleOverride"
import {System, World} from "./js_engine/core";
import {keyboardInput} from "./js_engine/input";
import {Camera} from "./js_engine/rendering/camera";
import {ConsoleRenderingSystem} from "./js_engine/rendering/2d/console/consoleRenderingSystem";
import {Size2d} from "./js_engine/rendering/2d/size2d";
import {Position2d} from "./js_engine/rendering/2d/position2d";
import {Bounds2d} from "./js_engine/rendering/2d/bounds2d";
import {ConsoleImage} from "./js_engine/rendering/2d/console/components";
import {Ansi} from "./js_engine/rendering/2d/console/ansi";


const world = new World();

const entityManager = world.entityManager;
// const buffer = new EntityChangeBuffer();
const buffer = entityManager


const cameraEntity = buffer.createEntity("cameraEntity");
const cameraPosition = new Position2d();
buffer.addComponent(cameraEntity, new Camera());
buffer.addComponent(cameraEntity, new Size2d());
buffer.addComponent(cameraEntity, cameraPosition);
buffer.addComponent(cameraEntity, new Bounds2d());

function createCross(position: Position2d, name?: string) {
    const objectEntity = buffer.createEntity(name);
    const objectImage = new ConsoleImage();
    objectImage.image = [
        Ansi.colors.fg.black + Ansi.colors.bg.white + ' 0 ',
        Ansi.colors.fg.black + Ansi.colors.bg.white + '000',
        Ansi.colors.fg.black + Ansi.colors.bg.white + ' 0 ',
    ]// white cross +
    buffer.addComponent(objectEntity, objectImage.size);
    buffer.addComponent(objectEntity, new Bounds2d());
    buffer.addComponent(objectEntity, position);
    buffer.addComponent(objectEntity, objectImage);
}

const position = new Position2d();
createCross(position, "cross1")
createCross(new Position2d(5, 5), "cross2")
createCross(new Position2d(1, 1), "cross3")
createCross(new Position2d(9, 9), "cross4")


keyboardInput.when({name: 'up'}, () => {
    cameraPosition.y -= 1;
    console.log("up")
})
keyboardInput.when({name: 'down'}, () => {
    cameraPosition.y += 1;
    console.log("down")
})
keyboardInput.when({name: 'left'}, () => {
    cameraPosition.x -= 1;
    console.log("left")
})
keyboardInput.when({name: 'right'}, () => {
    cameraPosition.x += 1;
    console.log("right")
})

keyboardInput.when({name: 'w'}, () => {
    position.y -= 1;
    console.log("up")
})
keyboardInput.when({name: 's'}, () => {
    position.y += 1;
    console.log("down")
})
keyboardInput.when({name: 'a'}, () => {
    position.x -= 1;
    console.log("left")
})
keyboardInput.when({name: 'd'}, () => {
    position.x += 1;
    console.log("right")
})


let toggle = true;
keyboardInput.when({name: 'c', ctrl: true}, () => {
    process.exit(0);
    // if (toggle) keyboardInput.disable();
    // else keyboardInput.enable();
    // toggle = !toggle;
})

// buffer.apply(entityManager)


console.log(cameraEntity)


class DebugSystem extends System {
    private _query = this.createEntityQuery([])

    onUpdate() {
        this._query.entityCount();
        const entities = this._query.stream({}, {includeEntity: true}).collect();
        console.log(entities)
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
}


world.getOrCreateSystem(ConsoleRenderingSystem);

// world.getOrCreateSystem(DebugSystem)
// world.getOrCreateSystem(ConsoleBoundsComputeSystem)

world.startLoop()
