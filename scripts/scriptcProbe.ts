import {World} from "../src/js_engine/core/world";
import {System} from "../src/js_engine/core/system";
import {Component} from "../src/js_engine/core/component";
import {Vec} from "../src/js_engine/math/types/vec";

const ENTITY_COUNT = 100;
const FRAME_COUNT = 10;

class Pos extends Component {
    public v = Vec.alloc3();
}

class Mover extends System {
    private query = this.createEntityQuery([Pos]);

    public override onUpdate(): void {
        this.query.stream({write: {pos: Pos}}).consume(({pos}) => {
            Vec.setX(pos.v, Vec.x(pos.v) + 1);
        });
    }
}

const world = new World();
const em = world.entityManager;
for (let i = 0; i < ENTITY_COUNT; i++) em.addComponent(em.createEntity(), new Pos());
const mover = world.getOrCreateSystem(Mover);
for (let frame = 0; frame < FRAME_COUNT; frame++) mover.update();
process.stdout.write("probe ok\n");
