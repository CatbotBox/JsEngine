import {Vec, Vec2, Vec3} from "../math/types/vec";

export interface TextureProvider {
    getColorAt(uvCoords: Vec2): Vec3;
}

export namespace TextureProvider {
    const CHECKER_A: Vec3 = Vec.alloc3(255, 0, 220);
    const CHECKER_B: Vec3 = Vec.alloc3(1, 0, 1);

    export const defaultTexture: TextureProvider = {
        getColorAt(uvCoords: Vec2): Vec3 {
            const x = Vec.x(uvCoords) > 0.5;
            const y = Vec.y(uvCoords) > 0.5;
            return (x !== y) ? CHECKER_A : CHECKER_B;
        },
    };
}
