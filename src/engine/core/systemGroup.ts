import {System, SystemCtor} from "./system";

export abstract class SystemGroup extends System {
    public get systems(): System[] {
        return this._systems;
    }

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

    public addSystem(system: SystemCtor<System>): void {
        const systemInstance = this.world.createSystem(system);
        this.addSystemInstance(systemInstance);
    }

    public addSystemInstance(systemInstance: System): void {
        this._systems.push(systemInstance);
        this._systems.sort((a, b) => a.priority() - b.priority());
    }

    public removeSystem(system: SystemCtor<System>): void {
        const instance = this.world.tryGetSystem(system)
        if (!instance) throw new Error("Can't remove system instance because it doesnt exist in world");
        this.removeSystemInstance(instance);
    }

    public removeSystemInstance(systemInstance: System): void {
        const index = this._systems.findIndex((t) => t === systemInstance);
        if (index == -1) throw new Error("Can't remove system instance because it does not exist in System Group");
        this._systems.splice(index, 1);

        systemInstance.destroy();
    }
}