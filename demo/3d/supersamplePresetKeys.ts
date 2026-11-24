import type {World} from "@jsengine/engine/core";
import {Input, resolveInputAction} from "@jsengine/engine/input";
import type {InputAction} from "@jsengine/engine/input";
import {Demo3dConfig} from "./config";
import type {SupersamplePreset} from "./config";

export class SupersamplePresetKeys {
    private readonly _actions = new Map<string, InputAction>();

    public constructor(private readonly world: World) {
        for (const preset of this.presets()) this.actionOf(preset.action);
    }

    public pressedPreset(): SupersamplePreset | undefined {
        const input = this.world.resources.get(Input);
        let pressed: SupersamplePreset | undefined;
        for (const preset of this.presets()) {
            if (input.actionPressed(this.actionOf(preset.action))) pressed = preset;
        }
        return pressed;
    }

    private presets(): readonly SupersamplePreset[] {
        return this.world.resources.get(Demo3dConfig).supersample;
    }

    private actionOf(name: string): InputAction {
        let action = this._actions.get(name);
        if (action === undefined) {
            action = resolveInputAction(this.world, name);
            this._actions.set(name, action);
        }
        return action;
    }
}
