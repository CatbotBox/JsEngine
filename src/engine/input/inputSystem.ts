import {System} from "../core/system";
import {Input} from "./input";
import {InputMap} from "./inputMap";

const UPDATE_FIRST_PRIORITY = Number.NEGATIVE_INFINITY;

export class InputSystem extends System {
    override priority(): number {
        return UPDATE_FIRST_PRIORITY;
    }

    public onUpdate(): void {
        const input = this.world.resources.getOrCreate(Input);
        input.useInputMap(this.world.resources.tryGet(InputMap));
        input.beginFrame();
    }
}
