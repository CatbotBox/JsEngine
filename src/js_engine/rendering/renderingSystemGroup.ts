import {SystemGroup} from "../core/";

export class RenderingSystemGroup extends SystemGroup {
    priority(): number {
        return 1000; // rendering should be done as late as possible
    }
}