import {Light} from "./light";
import {DIRECTIONAL_LIGHTS_CAST_SHADOWS} from "./sceneLights";

export class DirectionalLight extends Light {
    public castsShadows: boolean = DIRECTIONAL_LIGHTS_CAST_SHADOWS;

    public constructor(color?: number, intensity?: number) {
        super(color, intensity);
    }
}
