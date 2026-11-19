import {World} from "./world";
import type {EntityQuery} from "./entityQuery";

export abstract class WorldSource {
    protected constructor(public world: World) {
    }

    public adoptQuery(query: EntityQuery): void {
    }
}