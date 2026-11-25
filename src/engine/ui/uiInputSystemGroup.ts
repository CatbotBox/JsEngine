import {SystemGroup} from "../core";
import {UiEvents} from "./uiEvents";
import {UI_INPUT_PRIORITY} from "./uiSystemPriorities";
import {UiTreeIndex} from "./uiTreeIndex";

export class UiInputSystemGroup extends SystemGroup {
    override priority(): number {
        return UI_INPUT_PRIORITY;
    }

    protected onCreate() {
        this.world.resources.getOrCreate(UiEvents);
    }

    override onUpdate(): void {
        this.world.resources.getOrCreate(UiEvents).beginFrame(this.world.resources.tryGet(UiTreeIndex));
        super.onUpdate();
    }

    override onDisable(): void {
        super.onDisable();
        this.world.resources.tryGet(UiEvents)?.clear();
    }
}
