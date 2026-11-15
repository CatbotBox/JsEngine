import {System, SystemCtor} from "./system";

export abstract class SystemGroup extends System {
    public get systems(): System[] {
        return this._systems;
    }

    private _systems: System[] = [];

    protected blocksPresentation(): boolean {
        return false;
    }

    public override update(): void {
        if (!this.blocksPresentation()) {
            super.update();
            return;
        }
        const barriers = this.world.presentationBarriers;
        barriers.enter();
        try {
            super.update();
        } finally {
            barriers.exit();
        }
    }

    public onUpdate(): void {
        const systems = this._systems;
        const barriers = this.world.presentationBarriers;
        for (let index = 0; index < systems.length; index++) {
            if (index !== 0) barriers.atSystemBoundary();
            systems[index].update();
        }
    }

    public override destroy(): void {
        for (const system of [...this._systems]) {
            system.destroy();
        }
        super.destroy();
    }

    public onEnable(): void {
        for (const system of this._systems) {
            if (system.enabled) system.onEnable();
        }
    }

    public onDisable(): void {
        for (const system of this._systems) {
            if (system.enabled) system.onDisable();
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