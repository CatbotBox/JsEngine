import {describe, expect, test} from "../../../testing/harness";
import {MemoryPlatform} from "../../../testing/memoryPlatform";
import {World} from "../../../core/world";
import {RootSystemGroup} from "../../../core/rootSystemGroup";
import {TranslationSystemGroup} from "../../../translation/translationSystemGroup";
import {LocalToWorldSystem} from "../../../translation/localToWorldSystem";
import {LocalToWorld} from "../../../translation/localToWorld";
import {LocalPosition} from "../../../translation/localPosition";
import {LocalRotation} from "../../../translation/localRotation";
import {LocalScale} from "../../../translation/localScale";
import {Quaternions} from "../../../math/quaternions";
import {Vec} from "../../../math/types/vec";
import {DirectionalLight} from "./directionalLight";
import {PointLight} from "./pointLight";
import {AmbientLight} from "./ambientLight";
import {SpotLight, WIDEST_SPOT_CONE_ANGLE} from "./spotLight";
import {SphereAreaLight} from "./sphereAreaLight";
import {TubeAreaLight} from "./tubeAreaLight";
import {RectAreaLight} from "./rectAreaLight";
import {HemisphereLight} from "./hemisphereLight";
import {
    LIGHT_CASTS_NO_SHADOWS,
    LIGHT_CASTS_SHADOWS,
    LIGHT_KIND_DIRECTIONAL,
    LIGHT_KIND_POINT,
    LIGHT_KIND_RECT,
    LIGHT_KIND_SPHERE,
    LIGHT_KIND_SPOT,
    LIGHT_KIND_TUBE,
    SceneLights,
} from "./sceneLights";
import {SceneLightsGatherSystem} from "./sceneLightsGatherSystem";

function makeWorld() {
    const world = new World({platform: new MemoryPlatform()});
    world.getOrCreateSystem(TranslationSystemGroup);
    world.getOrCreateSystem(LocalToWorldSystem);
    world.getOrCreateSystem(SceneLightsGatherSystem);
    const root = world.getOrCreateSystem(RootSystemGroup);
    const tick = (n = 4) => {
        for (let i = 0; i < n; i++) root.update();
    };
    return {world, em: world.entityManager, tick, lights: () => world.resources.get(SceneLights)};
}

function rgbAt(array: Float32Array, index: number): number[] {
    return [array[index * 3], array[index * 3 + 1], array[index * 3 + 2]].map(v => Math.round(v * 1000) / 1000);
}

describe("Light components", () => {
    test("color is masked to 24 bits and intensity cannot go negative", () => {
        const light = new DirectionalLight(0x1FF8040, -3);
        expect(light.color).toBe(0xFF8040);
        expect(light.intensity).toBe(0);
    });

    test("writeScaledRgb unpacks the color to 0..1 scaled by intensity", () => {
        const out = new Float32Array(6);
        new PointLight(5, 0xFF8000, 0.5).writeScaledRgb(out, 3);
        expect(rgbAt(out, 1)).toEqual([0.5, 0.251, 0]);
        expect(rgbAt(out, 0)).toEqual([0, 0, 0]);
    });

    test("point light range cannot go negative and ambient defaults to a dim white", () => {
        expect(new PointLight(-1).range).toBe(0);
        const ambient = new AmbientLight();
        expect(ambient.color).toBe(0xFFFFFF);
        expect(ambient.intensity).toBeCloseTo(0.2, 6);
    });
});

describe("SceneLightsGatherSystem", () => {
    test("a world without lights gathers nothing and reports itself unlit", () => {
        const {tick, lights} = makeWorld();
        tick();
        expect(lights().count).toBe(0);
        expect(lights().hasAnyLight).toBe(false);
        expect(Array.from(lights().ambient)).toEqual([0, 0, 0]);
    });

    test("directional light direction is the entity's local +Z in world space, normalized despite scale", () => {
        const {em, tick, lights} = makeWorld();
        const e = em.createEntity("sun");
        em.addComponent(e, new LocalToWorld());
        em.addComponent(e, new LocalPosition(0, 0, 0));
        em.addComponent(e, new LocalScale(3, 3, 3));
        const quarterTurnAboutY = Quaternions.qFromAxisAngle(Vec.alloc3(0, 1, 0), Math.PI / 2);
        em.addComponent(e, new LocalRotation(Vec.x(quarterTurnAboutY), Vec.y(quarterTurnAboutY), Vec.z(quarterTurnAboutY), Vec.w(quarterTurnAboutY)));
        em.addComponent(e, new DirectionalLight(0x00FF00, 2));
        tick();

        const scene = lights();
        expect(scene.count).toBe(1);
        expect(scene.hasAnyLight).toBe(true);
        expect(scene.kind[0]).toBe(LIGHT_KIND_DIRECTIONAL);
        expect(rgbAt(scene.direction, 0)).toEqual([1, 0, 0]);
        expect(rgbAt(scene.color, 0)).toEqual([0, 2, 0]);
    });

    test("point light carries world position, scaled color and range", () => {
        const {em, tick, lights} = makeWorld();
        const e = em.createEntity("lamp");
        em.addComponent(e, new LocalToWorld());
        em.addComponent(e, new LocalPosition(1, 2, 3));
        em.addComponent(e, new PointLight(7, 0x0000FF, 0.5));
        tick();

        const scene = lights();
        expect(scene.count).toBe(1);
        expect(scene.kind[0]).toBe(LIGHT_KIND_POINT);
        expect(rgbAt(scene.position, 0)).toEqual([1, 2, 3]);
        expect(rgbAt(scene.color, 0)).toEqual([0, 0, 0.5]);
        expect(scene.range[0]).toBe(7);
    });

    test("ambient lights accumulate and count as lighting without occupying a slot", () => {
        const {em, tick, lights} = makeWorld();
        em.addComponent(em.createEntity("a"), new AmbientLight(0xFFFFFF, 0.25));
        em.addComponent(em.createEntity("b"), new AmbientLight(0xFF0000, 0.5));
        tick();

        const scene = lights();
        expect(scene.count).toBe(0);
        expect(scene.hasAnyLight).toBe(true);
        expect(rgbAt(scene.ambient, 0)).toEqual([0.75, 0.25, 0.25]);
    });

    test("the list is rebuilt every frame: removing a light shrinks it and arrays are reused", () => {
        const {em, tick, lights} = makeWorld();
        const sun = em.createEntity("sun");
        em.addComponent(sun, new LocalToWorld());
        em.addComponent(sun, new DirectionalLight());
        const lamp = em.createEntity("lamp");
        em.addComponent(lamp, new LocalToWorld());
        em.addComponent(lamp, new PointLight());
        tick();
        const scene = lights();
        expect(scene.count).toBe(2);
        const colorArray = scene.color;

        em.destroyEntity(sun);
        tick();
        expect(scene.count).toBe(1);
        expect(scene.kind[0]).toBe(LIGHT_KIND_POINT);
        expect(scene.color).toBe(colorArray);

        em.destroyEntity(lamp);
        tick();
        expect(scene.count).toBe(0);
        expect(scene.hasAnyLight).toBe(false);
    });

    test("more lights than the initial capacity grow the arrays and keep every entry", () => {
        const {em, tick, lights} = makeWorld();
        const total = 20;
        for (let i = 0; i < total; i++) {
            const e = em.createEntity("lamp" + i);
            em.addComponent(e, new LocalToWorld());
            em.addComponent(e, new LocalPosition(i, 0, 0));
            em.addComponent(e, new PointLight(i + 1));
        }
        tick();

        const scene = lights();
        expect(scene.count).toBe(total);
        expect(scene.capacity).toBeGreaterThan(total - 1);
        const xs = Array.from({length: total}, (_, i) => scene.position[i * 3]).sort((a, b) => a - b);
        expect(xs).toEqual(Array.from({length: total}, (_, i) => i));
        const ranges = Array.from(scene.range.subarray(0, total)).sort((a, b) => a - b);
        expect(ranges).toEqual(Array.from({length: total}, (_, i) => i + 1));
    });
});

const QUARTER_TURN = Math.PI / 2;
const SPOT_RANGE = 9;
const WIDE_SPOT_RANGE = 11;
const INNER_CONE = 0.3;
const OUTER_CONE = 0.5;
const SCALED = 3;
const MANY_TUBES = 20;

function rotationAbout(x: number, y: number, z: number, angle: number): LocalRotation {
    const q = Quaternions.qFromAxisAngle(Vec.alloc3(x, y, z), angle);
    return new LocalRotation(Vec.x(q), Vec.y(q), Vec.z(q), Vec.w(q));
}

function roundedValues(values: number[]): number[] {
    return values.map(v => Math.round(v * 1000) / 1000);
}

function withoutSignedZero(values: number[]): number[] {
    return values.map(v => v === 0 ? 0 : v);
}

function indexWithRange(scene: SceneLights, range: number): number {
    return Array.from(scene.range.subarray(0, scene.count)).indexOf(range);
}

describe("spot, area and hemisphere light components", () => {
    test("spot cone angles are clamped to between straight ahead and a right angle, and range cannot go negative", () => {
        const spot = new SpotLight(-1, -0.5, 4);
        expect([spot.range, spot.innerConeAngle, spot.outerConeAngle]).toEqual([0, 0, WIDEST_SPOT_CONE_ANGLE]);
        const defaults = new SpotLight();
        expect(defaults.innerConeAngle).toBeLessThan(defaults.outerConeAngle);
    });

    test("area light sizes cannot go negative", () => {
        expect(new SphereAreaLight(5, -1).radius).toBe(0);
        const tube = new TubeAreaLight(5, -2, -1);
        expect([tube.length, tube.radius]).toEqual([0, 0]);
        const rect = new RectAreaLight(5, -2, -1);
        expect([rect.width, rect.height]).toEqual([0, 0]);
    });

    test("a hemisphere light's sky colour is its light colour, both colours are masked to 24 bits and scaled by the one intensity", () => {
        const hemisphere = new HemisphereLight(0x1FF0000, 0x10000FF, 0.5);
        expect([hemisphere.skyColor, hemisphere.color, hemisphere.groundColor]).toEqual([0xFF0000, 0xFF0000, 0x0000FF]);
        hemisphere.skyColor = 0x00FF00;
        expect(hemisphere.color).toBe(0x00FF00);
        const out = new Float32Array(6);
        hemisphere.writeScaledRgb(out, 0);
        hemisphere.writeScaledGroundRgb(out, 3);
        expect([rgbAt(out, 0), rgbAt(out, 1)]).toEqual([[0, 0.5, 0], [0, 0, 0.5]]);
    });
});

describe("SceneLightsGatherSystem for spot, area and hemisphere lights", () => {
    test("a spot light carries its position, its +Z as direction and its cone cosines; an inner cone wider than the outer one is clipped to it", () => {
        const {em, tick, lights} = makeWorld();
        em.createEntity("spot", [new LocalToWorld(), new LocalPosition(1, 2, 3), rotationAbout(0, 1, 0, QUARTER_TURN), new SpotLight(SPOT_RANGE, INNER_CONE, OUTER_CONE, 0xFF0000, 2)]);
        em.createEntity("wide", [new LocalToWorld(), new LocalPosition(), new SpotLight(WIDE_SPOT_RANGE, OUTER_CONE * 2, OUTER_CONE)]);
        tick();
        const scene = lights();
        expect(Array.from(scene.kind.subarray(0, scene.count))).toEqual([LIGHT_KIND_SPOT, LIGHT_KIND_SPOT]);
        const spot = indexWithRange(scene, SPOT_RANGE);
        expect(rgbAt(scene.position, spot)).toEqual([1, 2, 3]);
        expect(rgbAt(scene.direction, spot)).toEqual([1, 0, 0]);
        expect(rgbAt(scene.color, spot)).toEqual([2, 0, 0]);
        expect(scene.coneCosInner[spot]).toBeCloseTo(Math.cos(INNER_CONE), 6);
        expect(scene.coneCosOuter[spot]).toBeCloseTo(Math.cos(OUTER_CONE), 6);
        const wide = indexWithRange(scene, WIDE_SPOT_RANGE);
        expect(scene.coneCosInner[wide]).toBe(scene.coneCosOuter[wide]);
    });

    test("sphere and tube lights carry position, radius and range; a tube's length lies along its local X, halved and unscaled by the entity", () => {
        const {em, tick, lights} = makeWorld();
        em.createEntity("bulb", [new LocalToWorld(), new LocalPosition(0, 1, 0), new SphereAreaLight(6, 0.4)]);
        em.createEntity("tube", [new LocalToWorld(), new LocalPosition(2, 0, 0), new LocalScale(SCALED, SCALED, SCALED), rotationAbout(0, 1, 0, QUARTER_TURN), new TubeAreaLight(7, 3, 0.1)]);
        tick();
        const scene = lights();
        expect(Array.from(scene.kind.subarray(0, scene.count))).toEqual([LIGHT_KIND_SPHERE, LIGHT_KIND_TUBE]);
        expect(rgbAt(scene.position, 0)).toEqual([0, 1, 0]);
        expect(roundedValues([scene.range[0], scene.radius[0]])).toEqual([6, 0.4]);
        expect(rgbAt(scene.position, 1)).toEqual([2, 0, 0]);
        expect(rgbAt(scene.axisX, 1)).toEqual([0, 0, -1]);
        expect(roundedValues([scene.range[1], scene.extentX[1], scene.radius[1]])).toEqual([7, 1.5, 0.1]);
    });

    test("a rect light faces its local +Z with its width along local X and its height along local Y, as half extents", () => {
        const {em, tick, lights} = makeWorld();
        em.createEntity("panel", [new LocalToWorld(), new LocalPosition(0, 3, 0), rotationAbout(0, 1, 0, QUARTER_TURN), new RectAreaLight(5, 2, 1)]);
        tick();
        const scene = lights();
        expect(scene.kind[0]).toBe(LIGHT_KIND_RECT);
        expect(rgbAt(scene.position, 0)).toEqual([0, 3, 0]);
        expect(rgbAt(scene.direction, 0)).toEqual([1, 0, 0]);
        expect(rgbAt(scene.axisX, 0)).toEqual([0, 0, -1]);
        expect(rgbAt(scene.axisY, 0)).toEqual([0, 1, 0]);
        expect([scene.extentX[0], scene.extentY[0]]).toEqual([1, 0.5]);
    });

    test("a hemisphere light takes no slot: its mean joins the ambient, its gradient follows the entity's up axis, and both go when it does", () => {
        const {em, tick, lights} = makeWorld();
        em.createEntity("ambient", [new AmbientLight(0xFFFFFF, 0.1)]);
        const sky = em.createEntity("sky", [new LocalToWorld(), new LocalPosition(), rotationAbout(1, 0, 0, QUARTER_TURN), new HemisphereLight(0xFF0000, 0x0000FF, 1)]);
        tick();
        const scene = lights();
        expect([scene.count, scene.hasAnyLight, scene.hasHemisphere]).toEqual([0, true, true]);
        expect(rgbAt(scene.ambient, 0)).toEqual([0.6, 0.1, 0.6]);
        expect(withoutSignedZero(rgbAt(scene.hemisphereGradient, 0))).toEqual([0, 0, 0.5]);
        expect(withoutSignedZero(rgbAt(scene.hemisphereGradient, 1))).toEqual([0, 0, 0]);
        expect(withoutSignedZero(rgbAt(scene.hemisphereGradient, 2))).toEqual([0, 0, -0.5]);

        em.destroyEntity(sky);
        tick();
        expect([scene.hasAnyLight, scene.hasHemisphere]).toEqual([true, false]);
        expect(Array.from(scene.hemisphereGradient)).toEqual(new Array(scene.hemisphereGradient.length).fill(0));
        expect(rgbAt(scene.ambient, 0)).toEqual([0.1, 0.1, 0.1]);
    });

    test("without a transform these lights are not gathered, like directional and point lights", () => {
        const {em, tick, lights} = makeWorld();
        em.createEntity("loose", [new SpotLight(), new SphereAreaLight(), new TubeAreaLight(), new RectAreaLight(), new HemisphereLight()]);
        tick();
        expect([lights().count, lights().hasAnyLight]).toEqual([0, false]);
    });

    test("growing past the initial capacity keeps every light's extra data", () => {
        const {em, tick, lights} = makeWorld();
        for (let i = 0; i < MANY_TUBES; i++) em.createEntity("tube" + i, [new LocalToWorld(), new LocalPosition(i, 0, 0), new TubeAreaLight(5, (i + 1) * 2, 0.1)]);
        tick();
        const scene = lights();
        expect(scene.count).toBe(MANY_TUBES);
        const halfLengths = Array.from(scene.extentX.subarray(0, MANY_TUBES)).sort((a, b) => a - b);
        expect(halfLengths).toEqual(Array.from({length: MANY_TUBES}, (_, i) => i + 1));
        expect(Array.from(scene.kind.subarray(0, MANY_TUBES)).every(kind => kind === LIGHT_KIND_TUBE)).toBe(true);
    });
});

describe("castsShadows", () => {
    test("directional lights cast by default and every other kind waits to opt in; software lighting never reads the flag", () => {
        expect([new DirectionalLight().castsShadows, new PointLight().castsShadows, new SpotLight().castsShadows,
            new SphereAreaLight().castsShadows, new TubeAreaLight().castsShadows, new RectAreaLight().castsShadows]).toEqual([true, false, false, false, false, false]);
    });

    test("the gather copies each light's flag into SceneLights by kind, and a regather replaces it", () => {
        const {em, tick, lights} = makeWorld();
        const sun = new DirectionalLight();
        const lamp = Object.assign(new PointLight(), {castsShadows: true});
        em.createEntity("sun", [new LocalToWorld(), sun]);
        em.createEntity("lamp", [new LocalToWorld(), new LocalPosition(1, 0, 0), lamp]);
        em.createEntity("spot", [new LocalToWorld(), new SpotLight()]);
        em.createEntity("sphere", [new LocalToWorld(), Object.assign(new SphereAreaLight(), {castsShadows: true})]);
        em.createEntity("tube", [new LocalToWorld(), new TubeAreaLight()]);
        em.createEntity("rect", [new LocalToWorld(), Object.assign(new RectAreaLight(), {castsShadows: true})]);
        tick();
        const flags = (scene: SceneLights) => Array.from({length: scene.count}, (_, i) => [scene.kind[i], scene.castsShadows[i]]);
        expect(flags(lights())).toEqual([
            [LIGHT_KIND_DIRECTIONAL, LIGHT_CASTS_SHADOWS], [LIGHT_KIND_POINT, LIGHT_CASTS_SHADOWS], [LIGHT_KIND_SPOT, LIGHT_CASTS_NO_SHADOWS],
            [LIGHT_KIND_SPHERE, LIGHT_CASTS_SHADOWS], [LIGHT_KIND_TUBE, LIGHT_CASTS_NO_SHADOWS], [LIGHT_KIND_RECT, LIGHT_CASTS_SHADOWS],
        ]);
        sun.castsShadows = false;
        lamp.castsShadows = false;
        tick();
        expect(flags(lights()).slice(0, 2)).toEqual([[LIGHT_KIND_DIRECTIONAL, LIGHT_CASTS_NO_SHADOWS], [LIGHT_KIND_POINT, LIGHT_CASTS_NO_SHADOWS]]);
    });
});
