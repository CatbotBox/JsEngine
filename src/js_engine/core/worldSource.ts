import {World} from "./world";

export abstract class WorldSource {
    protected constructor(public world: World) {
    }
}