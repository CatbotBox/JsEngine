import {System} from "../core/system";
import {Input} from "./input";

const UPDATE_FIRST_PRIORITY = Number.NEGATIVE_INFINITY;

export class InputSystem extends System {
    override priority(): number {
        return UPDATE_FIRST_PRIORITY;
    }

    public onUpdate(): void {
        this.world.resources.getOrCreate(Input).beginFrame();
    }
}
