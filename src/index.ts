import {Component, EntityCommandBuffer, System, World} from "./js_engine/core";
import {keyboardInput} from "./js_engine/input";
import {Camera} from "./js_engine/rendering/camera";
import {ConsoleRenderingSystem} from "./js_engine/rendering/2d/console/consoleRenderingSystem";
import {Size2d} from "./js_engine/rendering/2d/size2d";
import {Position2d} from "./js_engine/rendering/2d/position2d";
import {Bounds2d} from "./js_engine/rendering/2d/bounds2d";
import {ConsoleImage, ConsoleImageAnchor} from "./js_engine/rendering/2d/console/components";
import {Ansi} from "./js_engine/rendering/2d/console/ansi";
import {RootSystemGroup} from "./js_engine/core";
import {HudElement} from "./js_engine/rendering/hudElement";
import {EntityCommandBufferSystem} from "./js_engine/core/entityCommandBufferSystem";


const world = new World();

const buffer = world.getOrCreateSystem(EntityCommandBufferSystem).createEntityCommandBuffer()
// const buffer = world.entityManager


const cameraEntity = buffer.createEntity("cameraEntity");
const cameraPosition = new Position2d();
buffer.addComponent(cameraEntity, new Camera());
buffer.addComponent(cameraEntity, new Size2d());
buffer.addComponent(cameraEntity, cameraPosition);
buffer.addComponent(cameraEntity, new Bounds2d());

// can share the same image instance
const crossImage = new ConsoleImage();
crossImage.image = [
  Ansi.colors.bg.white + '0 0',
  Ansi.colors.bg.white + '   ',
  Ansi.colors.bg.white + '0 0',
]
crossImage.transparentChar = '0'
const crossImageSize = crossImage.size;

function createCross(position: Position2d, name?: string) {
  console.log("create cross at", position)
  const objectEntity = buffer.createEntity(name);
  buffer.addComponent(objectEntity, crossImageSize);
  buffer.addComponent(objectEntity, new Bounds2d());
  buffer.addComponent(objectEntity, position);
  buffer.addComponent(objectEntity, crossImage);
}

const position = new Position2d();
createCross(position, "cross1")
createCross(new Position2d(5, 5), "cross2")
createCross(new Position2d(1, 1), "cross3")
createCross(new Position2d(9, 9), "cross4")


//hud element
// entityCounter
const entityCounterEntity = buffer.createEntity("entityCounter");
const entityCounterImage = new ConsoleImage();
entityCounterImage.image = [
  Ansi.colors.fg.green + 'HUD element',
]
entityCounterImage.transparentChar = undefined; // no transparency for HUD
buffer.addComponent(entityCounterEntity, entityCounterImage);
buffer.addComponent(entityCounterEntity, new HudElement());
const anchor = new ConsoleImageAnchor()
anchor.anchorPosition = 'bottom-left';
buffer.addComponent(entityCounterEntity, anchor);
// fps counter
const fpsCounterEntity = buffer.createEntity("fpsCounter");
const fpsCounterImage = new ConsoleImage();
fpsCounterImage.image = [
  Ansi.colors.fg.green + 'FPS: 0',
]
fpsCounterImage.transparentChar = undefined; // no transparency for HUD
buffer.addComponent(fpsCounterEntity, fpsCounterImage);
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
  createCross(Component.clone(position));
})
keyboardInput.when({name: 'return'}, () => {
  console.log("space")
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
      // .map(e => ((e.entity as any)[OWNER].arch as EntityArchetype).getDataAtEntity(e.entity));
    // .map(e => {
    //     const archetype =   ((e.entity as any)[OWNER].arch as EntityArchetype);
    //     const data = archetype.getDataAtEntity(e.entity);
    //     const enabled = archetype.isEntityEnabled(e)
    //   });
    console.log("Entities:");
    // console.log(entities)
  }
}


world.getOrCreateSystem(ConsoleRenderingSystem);

world.getOrCreateSystem(DebugSystem)

world.startLoop()
