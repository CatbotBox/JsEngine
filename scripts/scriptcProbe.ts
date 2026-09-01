/**
 * scriptc measurement probe.
 *
 * `scriptc coverage` reports how much of a program compiles to native, but it
 * needs an entry point. The demos are not usable for this: they pull in the
 * console/logging/TTY layer, which scriptc's narrower node typings reject
 * outright, so analysis stops at typechecking and reports nothing.
 *
 * This entry exercises the parts worth compiling natively — archetype storage,
 * queries, the query stream, system update — and nothing else, so the coverage
 * number reflects the engine rather than the terminal I/O around it.
 *
 *     npm run scriptc:coverage
 *
 * Last measured (scriptc 0.0.35): 143 statements, 124 static (86%). The
 * remaining blockers are architectural, not incidental — see CLAUDE.md.
 *
 * It is a real program: `bun scripts/scriptcProbe.ts` runs it and prints "probe ok".
 */
import {World} from "../src/js_engine/core/world";
import {System} from "../src/js_engine/core/system";
import {Component} from "../src/js_engine/core/component";
import {Vec} from "../src/js_engine/math/types/vec";

class Pos extends Component {
    public v = Vec.alloc3();
}

class Mover extends System {
    private q = this.createEntityQuery([Pos]);

    public override onUpdate(): void {
        this.q.stream({write: {pos: Pos}}).forEach(row => {
            Vec.setX(row.pos.v, Vec.x(row.pos.v) + 1);
        });
    }
}

const world = new World();
const em = world.entityManager;
for (let i = 0; i < 100; i++) em.addComponent(em.createEntity(), new Pos());
const mover = world.getOrCreateSystem(Mover);
for (let frame = 0; frame < 10; frame++) mover.update();
process.stdout.write("probe ok\n");
