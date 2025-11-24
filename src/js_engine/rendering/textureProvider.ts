import {Vec2, Vec3} from "../math/types/vec";

export interface TextureProvider {
    getColorAt(uvCoords: Vec2): Vec3;

}

export namespace TextureProvider {
    export const defaultTexture: TextureProvider = {
        getColorAt(uvCoords: Vec2): Vec3 {
            const x = uvCoords[0] > 0.5;
            const y = uvCoords[1] > 0.5;

            return (x !== y) ? [255, 0, 220] as Vec3 : [1, 0, 1] as Vec3;
        }
    }
}