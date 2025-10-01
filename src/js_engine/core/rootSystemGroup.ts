import {SystemGroup} from "./systemGroup";
import {System, SystemCtor} from "./system";

export class RootSystemGroup extends SystemGroup {
    protected onCreate() {
        // self is added as child of self by default, just remove
        this.systems.length = 0;
    }

    override removeSystemInstance(systemInstance: System): void {
        if (systemInstance === this) return;
        super.removeSystemInstance(systemInstance);
    }
}