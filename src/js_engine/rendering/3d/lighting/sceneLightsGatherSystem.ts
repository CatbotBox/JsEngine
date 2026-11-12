import {System} from "../../../core";
import {asFloat32Array} from "../../../math/types/vec";
import {LocalToWorld} from "../../../translation";
import {RenderingSystemGroup} from "../../renderingSystemGroup";
import {DirectionalLight} from "./directionalLight";
import {PointLight} from "./pointLight";
import {AmbientLight} from "./ambientLight";
import {SceneLights} from "./sceneLights";

const scratchRgb = new Float32Array(3);
const PRIORITY_BEFORE_RENDER_PASSES = -10;
const LOCAL_Z_AXIS_X = 8;
const LOCAL_Z_AXIS_Y = 9;
const LOCAL_Z_AXIS_Z = 10;
const TRANSLATION_X = 12;
const TRANSLATION_Y = 13;
const TRANSLATION_Z = 14;

export class SceneLightsGatherSystem extends System {
    private _directionalQuery = this.createEntityQuery([DirectionalLight, LocalToWorld]);
    private _pointQuery = this.createEntityQuery([PointLight, LocalToWorld]);
    private _ambientQuery = this.createEntityQuery([AmbientLight]);

    override systemGroup() {
        return RenderingSystemGroup;
    }

    override priority(): number {
        return PRIORITY_BEFORE_RENDER_PASSES;
    }

    onUpdate() {
        const lights = this.world.resources.getOrCreate(SceneLights);
        lights.beginGather();

        this._ambientQuery.stream({read: {light: AmbientLight}}).consume(({light}) => {
            light.writeScaledRgb(scratchRgb, 0);
            lights.addAmbient(scratchRgb[0], scratchRgb[1], scratchRgb[2]);
        });

        this._directionalQuery.stream({read: {light: DirectionalLight, localToWorld: LocalToWorld}}).consume(({light, localToWorld}) => {
            const m = asFloat32Array(localToWorld.matrix);
            light.writeScaledRgb(scratchRgb, 0);
            lights.addDirectional(m[LOCAL_Z_AXIS_X], m[LOCAL_Z_AXIS_Y], m[LOCAL_Z_AXIS_Z], scratchRgb[0], scratchRgb[1], scratchRgb[2]);
        });

        this._pointQuery.stream({read: {light: PointLight, localToWorld: LocalToWorld}}).consume(({light, localToWorld}) => {
            const m = asFloat32Array(localToWorld.matrix);
            light.writeScaledRgb(scratchRgb, 0);
            lights.addPoint(m[TRANSLATION_X], m[TRANSLATION_Y], m[TRANSLATION_Z], scratchRgb[0], scratchRgb[1], scratchRgb[2], light.range);
        });
    }
}
