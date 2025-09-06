import "./js_engine/debugging/console"
import {Component, EntityQuery, System, World} from "./js_engine/core";
import {Camera, ConsoleRenderingSystem, Position2d, Size2} from "./js_engine/rendering/console/components";
import {EntityChangeBuffer} from "./js_engine/core/entityChangeBuffer";
import {keyboardInput} from "./js_engine/input";


class LogMessage extends Component {

  constructor(message: string) {
    super();
    this.message = message;
  }

  get message(): string {
    return this._message;
  }

  set message(value: string) {
    this._message = value;
  }

  private _message: string = "";
}

class Test extends Component {

}

class Test2 extends Component {
  str = "test";

  constructor(message: string) {
    super();
    this.str = message;
  }
}

class LoggingSystem extends System {
  // private _query!: ReturnType<LoggingSystem['makeQuery']>;
  private _query = this.createEntityQuery([LogMessage], [Test]);


  protected onCreate() {
  }

  onUpdate() {
    // console.log("updating Logging System");
    // console.log(this._query.entityCount());
    this._query.stream({
      message: LogMessage,
      test2: Test2
    })
      .forEach(({message, test2}) => {
        console.log(message.message + (test2?.str || ""));
      });
    this.entityManager.destroy(this._query)
  }
}


const world = new World();
world.getOrCreateSystem(LoggingSystem);
world.getOrCreateSystem(ConsoleRenderingSystem);


const entityManager = world.entityManager;
const buffer = new EntityChangeBuffer();
// const buffer = entityManager


const entity0 = buffer.createEntity("entity0")

buffer.addComponent(entity0, new LogMessage("test"))


const entity1 = buffer.createEntity("entity1")

buffer.addComponent(entity1, new LogMessage("test"))


const entity2 = buffer.createEntity("entity2")

buffer.addComponent(entity2, new LogMessage("msg"))
buffer.addComponent(entity2, new Test())


const entity3 = buffer.createEntity("entity3")
buffer.addComponent(entity3, new LogMessage("msg"))
buffer.addComponent(entity3, new Test2("test"))


const cameraEntity = buffer.createEntity("cameraEntity");
const cameraPosition = new Position2d();
buffer.addComponent(cameraEntity, new Camera());
buffer.addComponent(cameraEntity, new Size2());
buffer.addComponent(cameraEntity, cameraPosition);


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
let toggle = true;
keyboardInput.when({name: 'q', ctrl: true}, () => {
  if (toggle) keyboardInput.disable();
  else keyboardInput.enable();
  toggle = !toggle;
})

buffer.apply(entityManager)


console.log(cameraEntity)


class DebugSystem extends System {
  private _query = this.createEntityQuery([], []);

  onUpdate() {
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


world.getOrCreateSystem(DebugSystem)

world.startLoop()
