import {System} from "./system";

export abstract class SystemGroup extends System {
    private _systems: System[] = [];

    public onUpdate(): void {
        for (const system of this._systems) {
            system.update();
        }
    }

    public onDestroy(): void {
        for (const system of this._systems) {
            system.destroy();
        }
    }

    public onEnable(): void {
        for (const system of this._systems) {
            system.onEnable();
        }
    }

    public onDisable(): void {
        for (const system of this._systems) {
            system.onDisable()
        }
    }

    public addSystem<T extends System>(system: new () => T): void {
        const systemInstance = this.world.createSystem(system);
        this._systems.push(systemInstance);
        this._systems.sort((a, b) => a.priority() - b.priority());
    }

    public addSystemInstance<T extends System>(systemInstance: T): void {
        this._systems.push(systemInstance);
        this._systems.sort((a, b) => a.priority() - b.priority());
    }


    destroy() {
        for (const system of this._systems) {
            system.destroy();
        }
    }

    debug() {
        console.group("SystemGroup", this.constructor.name);
        for (const system of this._systems) {
            if (system instanceof SystemGroup) {
                system.debug()
            } else {
                console.log("System", system.constructor.name);
            }
        }
        console.groupEnd();
    }
}