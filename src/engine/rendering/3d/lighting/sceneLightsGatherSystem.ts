import {System} from "../../../core";
import {asFloat32Array} from "../../../math/types/vec";
import {LocalToWorld} from "../../../translation";
import {RenderingSystemGroup} from "../../renderingSystemGroup";
import {DirectionalLight} from "./directionalLight";
import {PointLight} from "./pointLight";
import {AmbientLight} from "./ambientLight";
import {SpotLight} from "./spotLight";
import {SphereAreaLight} from "./sphereAreaLight";
import {TubeAreaLight} from "./tubeAreaLight";
import {RectAreaLight} from "./rectAreaLight";
import {HemisphereLight} from "./hemisphereLight";
import {SceneLights} from "./sceneLights";
import {MAT4_TRANSLATION_X, MAT4_TRANSLATION_Y, MAT4_TRANSLATION_Z} from "../../../math/mat4Layout";

const GROUND_RGB_OFFSET = 3;
const SKY_AND_GROUND_FLOATS = 6;
const scratchRgb = new Float32Array(SKY_AND_GROUND_FLOATS);
const PRIORITY_BEFORE_RENDER_PASSES = -10;
const LOCAL_Z_AXIS_X = 8;
const LOCAL_Z_AXIS_Y = 9;
const LOCAL_Z_AXIS_Z = 10;
const LOCAL_X_AXIS_X = 0;
const LOCAL_X_AXIS_Y = 1;
const LOCAL_X_AXIS_Z = 2;
const LOCAL_Y_AXIS_X = 4;
const LOCAL_Y_AXIS_Y = 5;
const LOCAL_Y_AXIS_Z = 6;
const HALF = 0.5;

export class SceneLightsGatherSystem extends System {
    private _directionalQuery = this.createEntityQuery([DirectionalLight, LocalToWorld]);
    private _pointQuery = this.createEntityQuery([PointLight, LocalToWorld]);
    private _ambientQuery = this.createEntityQuery([AmbientLight]);
    private _spotQuery = this.createEntityQuery([SpotLight, LocalToWorld]);
    private _sphereQuery = this.createEntityQuery([SphereAreaLight, LocalToWorld]);
    private _tubeQuery = this.createEntityQuery([TubeAreaLight, LocalToWorld]);
    private _rectQuery = this.createEntityQuery([RectAreaLight, LocalToWorld]);
    private _hemisphereQuery = this.createEntityQuery([HemisphereLight, LocalToWorld]);

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
            lights.addDirectional(m[LOCAL_Z_AXIS_X], m[LOCAL_Z_AXIS_Y], m[LOCAL_Z_AXIS_Z], scratchRgb[0], scratchRgb[1], scratchRgb[2], light.castsShadows);
        });

        this._pointQuery.stream({read: {light: PointLight, localToWorld: LocalToWorld}}).consume(({light, localToWorld}) => {
            const m = asFloat32Array(localToWorld.matrix);
            light.writeScaledRgb(scratchRgb, 0);
            lights.addPoint(m[MAT4_TRANSLATION_X], m[MAT4_TRANSLATION_Y], m[MAT4_TRANSLATION_Z], scratchRgb[0], scratchRgb[1], scratchRgb[2], light.range, light.castsShadows);
        });

        this._spotQuery.stream({read: {light: SpotLight, localToWorld: LocalToWorld}}).consume(({light, localToWorld}) => {
            const m = asFloat32Array(localToWorld.matrix);
            light.writeScaledRgb(scratchRgb, 0);
            const outer = light.outerConeAngle;
            lights.addSpot(m[MAT4_TRANSLATION_X], m[MAT4_TRANSLATION_Y], m[MAT4_TRANSLATION_Z], m[LOCAL_Z_AXIS_X], m[LOCAL_Z_AXIS_Y], m[LOCAL_Z_AXIS_Z],
                scratchRgb[0], scratchRgb[1], scratchRgb[2], light.range, Math.cos(Math.min(light.innerConeAngle, outer)), Math.cos(outer), light.castsShadows);
        });

        this._sphereQuery.stream({read: {light: SphereAreaLight, localToWorld: LocalToWorld}}).consume(({light, localToWorld}) => {
            const m = asFloat32Array(localToWorld.matrix);
            light.writeScaledRgb(scratchRgb, 0);
            lights.addSphere(m[MAT4_TRANSLATION_X], m[MAT4_TRANSLATION_Y], m[MAT4_TRANSLATION_Z], scratchRgb[0], scratchRgb[1], scratchRgb[2], light.range, light.radius, light.castsShadows);
        });

        this._tubeQuery.stream({read: {light: TubeAreaLight, localToWorld: LocalToWorld}}).consume(({light, localToWorld}) => {
            const m = asFloat32Array(localToWorld.matrix);
            light.writeScaledRgb(scratchRgb, 0);
            lights.addTube(m[MAT4_TRANSLATION_X], m[MAT4_TRANSLATION_Y], m[MAT4_TRANSLATION_Z], m[LOCAL_X_AXIS_X], m[LOCAL_X_AXIS_Y], m[LOCAL_X_AXIS_Z],
                scratchRgb[0], scratchRgb[1], scratchRgb[2], light.range, light.length * HALF, light.radius, light.castsShadows);
        });

        this._rectQuery.stream({read: {light: RectAreaLight, localToWorld: LocalToWorld}}).consume(({light, localToWorld}) => {
            const m = asFloat32Array(localToWorld.matrix);
            light.writeScaledRgb(scratchRgb, 0);
            lights.addRect(m[MAT4_TRANSLATION_X], m[MAT4_TRANSLATION_Y], m[MAT4_TRANSLATION_Z], m[LOCAL_Z_AXIS_X], m[LOCAL_Z_AXIS_Y], m[LOCAL_Z_AXIS_Z],
                m[LOCAL_X_AXIS_X], m[LOCAL_X_AXIS_Y], m[LOCAL_X_AXIS_Z], m[LOCAL_Y_AXIS_X], m[LOCAL_Y_AXIS_Y], m[LOCAL_Y_AXIS_Z],
                scratchRgb[0], scratchRgb[1], scratchRgb[2], light.range, light.width * HALF, light.height * HALF, light.castsShadows);
        });

        this._hemisphereQuery.stream({read: {light: HemisphereLight, localToWorld: LocalToWorld}}).consume(({light, localToWorld}) => {
            const m = asFloat32Array(localToWorld.matrix);
            light.writeScaledRgb(scratchRgb, 0);
            light.writeScaledGroundRgb(scratchRgb, GROUND_RGB_OFFSET);
            lights.addHemisphere(m[LOCAL_Y_AXIS_X], m[LOCAL_Y_AXIS_Y], m[LOCAL_Y_AXIS_Z],
                scratchRgb[0], scratchRgb[1], scratchRgb[2], scratchRgb[GROUND_RGB_OFFSET], scratchRgb[GROUND_RGB_OFFSET + 1], scratchRgb[GROUND_RGB_OFFSET + 2]);
        });
    }
}
