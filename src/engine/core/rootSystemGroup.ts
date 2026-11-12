import {SystemGroup} from "./systemGroup";
import {System, SystemCtor} from "./system";

export class RootSystemGroup extends SystemGroup {
    override removeSystemInstance(systemInstance: System): void {
        if (systemInstance === this) return;
        super.removeSystemInstance(systemInstance);
    }
}
