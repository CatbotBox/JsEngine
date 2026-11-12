import {Light} from "./light";

const DEFAULT_AMBIENT_INTENSITY = 0.2;

export class AmbientLight extends Light {
    public constructor(color?: number, intensity: number = DEFAULT_AMBIENT_INTENSITY) {
        super(color, intensity);
    }
}
