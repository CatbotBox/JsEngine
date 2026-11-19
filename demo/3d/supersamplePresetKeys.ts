import type {World} from "../../src/engine/core";
import {Input, resolveInputAction} from "../../src/engine/input";
import type {InputAction} from "../../src/engine/input";
import {Demo3dTuning} from "./tuning";
import type {SupersamplePreset} from "./tuning";

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
        return this.world.resources.get(Demo3dTuning).supersample;
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
