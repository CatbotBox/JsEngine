import {afterEach, describe, expect, test} from "../../engine/testing/harness";
import {Vec} from "../../engine/math/types/vec";
import {Mesh, MeshBuilder} from "../../engine/rendering/3d/mesh";
import {Material} from "../../engine/rendering/3d/material";
import {Texture} from "../../engine/rendering/3d/texture";
import {FaceCulling} from "../../engine/rendering/3d/faceCulling";
import {GpuMeshCache} from "./gpuMeshCache";
import {GpuMaterialCache, materialSamplerDescriptor, packMaterial, specularCutoffOf} from "./gpuMaterialCache";
import {GpuTextureCache} from "./gpuTextureCache";
import {cullModeOf, GpuPipelineCache, SOFTWARE_FRONT_FACE} from "./gpuPipelineCache";
import {GpuShaderLibrary} from "./gpuShaderLibrary";
import {LIT_SURFACE_SHADER} from "./gpuSurfaceShader";
import type {GpuShader} from "./gpuTypes";
import {
    assembleSurfaceShader,
    BASIC_LIT,
    HIGHEST_NORMAL_DOT_HALF,
    MATERIAL_SAMPLER_BINDING,
    MATERIAL_SPECULAR_CUTOFF_OFFSET,
    MATERIAL_SPECULAR_TEXTURE_BINDING,
    MATERIAL_TEXTURE_BINDING,
    MATERIAL_TEXTURED,
    MATERIAL_TEXTURED_OFFSET,
    MATERIAL_UNIFORM_FLOATS,
    MATERIAL_UNTEXTURED,
    SURFACE_FUNCTION_SIGNATURE,
} from "./shaders/basicLitShader";
import {LINEAR_TEXTURE_FILTERING, MULTISAMPLE_COUNT, NEAREST_TEXTURE_FILTERING, SINGLE_SAMPLE_COUNT} from "./gpuMeshPassSettings";
import type {GpuTextureFiltering} from "./gpuMeshPassSettings";
import {compilationError, FakeGpuBuffer, FakeGpuDevice, FakeGpuTextureView} from "./testing/fakeGpuDevice";
import type {FakeGpuShaderModule} from "./testing/fakeGpuDevice";
import {ConsoleRecorder} from "./testing/consoleRecorder";

const EVICT_AFTER_FRAMES = 3;
const FRAME = 1;
const FORMAT: GPUTextureFormat = "bgra8unorm";
const OTHER_FORMAT: GPUTextureFormat = "rgba8unorm";
const TEXTURE_SIDE = 2;
const RGBA_BYTES = 4;
const SHININESS = 32;
const UNKNOWN_FILTERING = "anisotropic" as GpuTextureFiltering;
const TOON = "toon";
const PULSE = "pulse";
const BROKEN = "broken";
const UNLINKABLE = "unlinkable";
const TOON_SOURCE = `${SURFACE_FUNCTION_SIGNATURE} {
    return vec4f(input.lit.rgb * 0.5, 1.0);
}`;
const PULSE_SOURCE = `${SURFACE_FUNCTION_SIGNATURE} {
    return vec4f(input.lit.rgb * sin(input.time), 1.0);
}`;
const PULSE_FASTER_SOURCE = `${SURFACE_FUNCTION_SIGNATURE} {
    return vec4f(input.lit.rgb * sin(input.time * 2.0), 1.0);
}`;
const BROKEN_SOURCE = `${SURFACE_FUNCTION_SIGNATURE} {
    return oops;
}`;
const BROKEN_TOKEN = "oops";
const BROKEN_COLUMN = 12;
const PIPELINE_FAILURE = "entry point not found";
const SETTLE_TASKS = 3;
const MANY_FRAMES = 6;

const recorders: ConsoleRecorder[] = [];

function recordConsole(): ConsoleRecorder {
    const recorder = new ConsoleRecorder();
    recorders.push(recorder);
    return recorder;
}

afterEach(() => {
    for (const recorder of recorders.splice(0)) recorder.detach();
});

const nextTask = () => new Promise<void>(done => setTimeout(done, 0));

async function settle(): Promise<void> {
    for (let i = 0; i < SETTLE_TASKS; i++) await nextTask();
}

function pipelineCache(device: FakeGpuDevice): GpuPipelineCache {
    return new GpuPipelineCache(device, device.createPipelineLayout({bindGroupLayouts: []}));
}

function descriptorOf(pipeline: GPURenderPipeline): GPURenderPipelineDescriptor {
    return pipeline as unknown as GPURenderPipelineDescriptor;
}

function shaderNameOf(pipeline: GPURenderPipeline): string {
    return descriptorOf(pipeline).label!.split("|")[0];
}

function codeOf(pipeline: GPURenderPipeline): string {
    return (descriptorOf(pipeline).vertex.module as unknown as FakeGpuShaderModule).descriptor.code;
}

async function readyPipeline(cache: GpuPipelineCache, shader: GpuShader, culling: FaceCulling = FaceCulling.BackFaces): Promise<GPURenderPipeline> {
    cache.pipelineFor(shader, culling, FORMAT, MULTISAMPLE_COUNT, FRAME);
    await settle();
    cache.pipelineFor(shader, culling, FORMAT, MULTISAMPLE_COUNT, FRAME);
    await settle();
    return cache.pipelineFor(shader, culling, FORMAT, MULTISAMPLE_COUNT, FRAME);
}

function lineOf(code: string, token: string): number {
    return code.split("\n").findIndex(line => line.includes(token)) + 1;
}

function triangle(): Mesh {
    const builder = new MeshBuilder();
    builder.vertices.push(Vec.alloc3(0, 0, 0), Vec.alloc3(1, 0, 0), Vec.alloc3(0, 1, 0));
    builder.uvs.push(Vec.alloc2(), Vec.alloc2(), Vec.alloc2());
    builder.triangles.push(Vec.alloc3(0, 2, 1));
    builder.generateNormals();
    return new Mesh(builder);
}

function texture(): Texture {
    return Texture.fromRgba(TEXTURE_SIDE, TEXTURE_SIDE, new Uint8Array(TEXTURE_SIDE * TEXTURE_SIDE * RGBA_BYTES).fill(0xFF));
}

interface MaterialCaches {
    readonly materials: GpuMaterialCache;
    readonly textures: GpuTextureCache;
}

function materialCaches(device: FakeGpuDevice): MaterialCaches {
    const layout = device.createBindGroupLayout({entries: []});
    const textures = new GpuTextureCache(device);
    return {materials: new GpuMaterialCache(device, layout, textures), textures};
}

function materialCache(device: FakeGpuDevice): GpuMaterialCache {
    return materialCaches(device).materials;
}

function drawFramesUntilEviction({materials, textures}: MaterialCaches, drawn: Material): number {
    const evictionFrame = FRAME + EVICT_AFTER_FRAMES + 1;
    for (let frame = FRAME + 1; frame <= evictionFrame; frame++) {
        materials.prepare(drawn, true, NEAREST_TEXTURE_FILTERING, frame);
        materials.evictUnused(frame, EVICT_AFTER_FRAMES);
        textures.evictUnused(frame, EVICT_AFTER_FRAMES);
    }
    return evictionFrame;
}

function boundResource(bindGroup: GPUBindGroup, binding: number): unknown {
    return [...(bindGroup as unknown as GPUBindGroupDescriptor).entries].find(entry => entry.binding === binding)!.resource;
}

function boundTexture(bindGroup: GPUBindGroup, binding: number): GPUTextureDescriptor {
    return (boundResource(bindGroup, binding) as FakeGpuTextureView).texture.descriptor;
}

describe("GpuMeshCache", () => {
    test("uploads a mesh once, however many frames draw it", () => {
        const device = new FakeGpuDevice();
        const cache = new GpuMeshCache(device);
        const mesh = triangle();
        const first = cache.ensure(mesh, 1);
        expect(cache.ensure(mesh, 2)).toBe(first);
        expect(cache.ensure(mesh, 3)).toBe(first);
        expect(device.buffers.length).toBe(2);
        expect(device.queue.bufferWrites.length).toBe(2);
        expect(first.ranges).toEqual([{material: 0, firstIndex: 0, indexCount: 3}]);
    });

    test("evicts a mesh unused for more than the given frames, destroying its buffers, and uploads it again on return", () => {
        const device = new FakeGpuDevice();
        const cache = new GpuMeshCache(device);
        const kept = triangle(), dropped = triangle();
        cache.ensure(kept, 1);
        cache.ensure(dropped, 1);
        for (let frame = 2; frame <= 1 + EVICT_AFTER_FRAMES; frame++) {
            cache.ensure(kept, frame);
            cache.evictUnused(frame, EVICT_AFTER_FRAMES);
        }
        expect(cache.size).toBe(2);
        cache.ensure(kept, 2 + EVICT_AFTER_FRAMES);
        cache.evictUnused(2 + EVICT_AFTER_FRAMES, EVICT_AFTER_FRAMES);
        expect(cache.size).toBe(1);
        expect(device.liveBuffers().length).toBe(2);
        cache.ensure(dropped, 3 + EVICT_AFTER_FRAMES);
        expect(device.buffers.length).toBe(6);
    });

    test("dispose destroys every buffer", () => {
        const device = new FakeGpuDevice();
        const cache = new GpuMeshCache(device);
        cache.ensure(triangle(), 1);
        cache.ensure(triangle(), 1);
        cache.dispose();
        expect([device.liveBuffers().length, cache.size]).toEqual([0, 0]);
    });
});

describe("GpuMaterialCache", () => {
    test("a texture shared by two materials, as diffuse and as gloss map, is uploaded once", () => {
        const device = new FakeGpuDevice();
        const cache = materialCache(device);
        const shared = texture();
        const a = new Material("a"), b = new Material("b");
        a.diffuseTexture = shared;
        b.diffuseTexture = shared;
        b.specularTexture = shared;
        cache.prepare(a, true, NEAREST_TEXTURE_FILTERING, FRAME);
        cache.prepare(b, true, NEAREST_TEXTURE_FILTERING, FRAME);
        expect(device.textures.map(uploaded => uploaded.descriptor.label)).toEqual(["material texture", "white"]);
        expect(cache.size).toBe(2);
    });

    test("writes the uniform on creation and again only when the packed values change", () => {
        const device = new FakeGpuDevice();
        const cache = materialCache(device);
        const material = new Material("m", 0x336699);
        material.diffuseTexture = texture();
        const prepared = cache.prepare(material, true, NEAREST_TEXTURE_FILTERING, FRAME);
        cache.prepare(material, true, NEAREST_TEXTURE_FILTERING, FRAME);
        expect(device.queue.writesTo(prepared.uniformBuffer).length).toBe(1);
        cache.prepare(material, false, NEAREST_TEXTURE_FILTERING, FRAME);
        cache.prepare(material, false, NEAREST_TEXTURE_FILTERING, FRAME);
        const writes = device.queue.writesTo(prepared.uniformBuffer);
        expect(writes.length).toBe(2);
        expect((writes[0].data as Float32Array)[MATERIAL_TEXTURED_OFFSET]).toBe(MATERIAL_TEXTURED);
        expect((writes[1].data as Float32Array)[MATERIAL_TEXTURED_OFFSET]).toBe(MATERIAL_UNTEXTURED);
        material.diffuseColor = 0xFFFFFF;
        cache.prepare(material, false, NEAREST_TEXTURE_FILTERING, FRAME);
        expect(device.queue.writesTo(prepared.uniformBuffer).length).toBe(3);
    });

    test("a new texture rebinds the material without a new uniform buffer", () => {
        const device = new FakeGpuDevice();
        const cache = materialCache(device);
        const material = new Material("m");
        const before = cache.prepare(material, true, NEAREST_TEXTURE_FILTERING, FRAME).bindGroup;
        material.diffuseTexture = texture();
        const after = cache.prepare(material, true, NEAREST_TEXTURE_FILTERING, FRAME);
        expect(after.bindGroup).not.toBe(before);
        expect(device.buffers.length).toBe(1);
    });

    test("packs the material as diffuse, emissive, specular with shininess, then the textured flag and the specular cutoff", () => {
        const material = new Material("m", 0xFF8000);
        material.emissiveColor = 0x0000FF;
        material.specularColor = 0xFFFFFF;
        material.shininess = SHININESS;
        const packed = new Float32Array(MATERIAL_UNIFORM_FLOATS);
        packMaterial(material, true, packed);
        const cutoff = specularCutoffOf(material);
        expect(Array.from(packed)).toEqual(Array.from(new Float32Array([1, 0x80 / 0xFF, 0, 1, 0, 0, 1, 0, 1, 1, 1, SHININESS, MATERIAL_UNTEXTURED, cutoff, 0, 0])));
        expect(MATERIAL_SPECULAR_CUTOFF_OFFSET).toBe(MATERIAL_TEXTURED_OFFSET + 1);
    });

    test("the specular cutoff is the n.h whose highlight drops below 0.005, and above any n.h when the material has no specular colour", () => {
        const glossy = new Material("glossy");
        glossy.specularColor = 0x333333;
        glossy.shininess = SHININESS;
        expect(Math.pow(specularCutoffOf(glossy), SHININESS)).toBeCloseTo(0.005, 9);
        glossy.shininess = 0;
        expect(specularCutoffOf(glossy)).toBe(0);
        const matte = new Material("matte");
        matte.shininess = SHININESS;
        expect(specularCutoffOf(matte)).toBeGreaterThan(HIGHEST_NORMAL_DOT_HALF);
    });

    test("binds the specular texture as the gloss map, the white texture when there is none, and rebinds when it changes", () => {
        const device = new FakeGpuDevice();
        const cache = materialCache(device);
        const material = new Material("m");
        const plain = cache.prepare(material, true, NEAREST_TEXTURE_FILTERING, FRAME).bindGroup;
        expect(boundTexture(plain, MATERIAL_SPECULAR_TEXTURE_BINDING).label).toBe("white");
        material.specularTexture = texture();
        const glossy = cache.prepare(material, true, NEAREST_TEXTURE_FILTERING, FRAME).bindGroup;
        expect(glossy).not.toBe(plain);
        expect(boundTexture(glossy, MATERIAL_SPECULAR_TEXTURE_BINDING).label).toBe("material texture");
        expect(boundTexture(glossy, MATERIAL_TEXTURE_BINDING).label).toBe("white");
        expect(cache.prepare(material, false, NEAREST_TEXTURE_FILTERING, FRAME).bindGroup).toBe(glossy);
    });

    test("a filtering change rebinds the material with that filtering's sampler, one sampler per filtering", () => {
        const device = new FakeGpuDevice();
        const cache = materialCache(device);
        const material = new Material("m");
        const nearest = cache.prepare(material, true, NEAREST_TEXTURE_FILTERING, FRAME).bindGroup;
        const linear = cache.prepare(material, true, LINEAR_TEXTURE_FILTERING, FRAME).bindGroup;
        expect(linear).not.toBe(nearest);
        expect(cache.prepare(material, true, LINEAR_TEXTURE_FILTERING, FRAME).bindGroup).toBe(linear);
        expect((boundResource(nearest, MATERIAL_SAMPLER_BINDING) as GPUSamplerDescriptor).magFilter).toBe("nearest");
        expect((boundResource(linear, MATERIAL_SAMPLER_BINDING) as GPUSamplerDescriptor).magFilter).toBe("linear");
        cache.prepare(new Material("other"), true, NEAREST_TEXTURE_FILTERING, FRAME);
        expect(device.samplers.length).toBe(2);
        expect(device.buffers.length).toBe(2);
    });

    test("evicts a material unused for more than the given frames, destroying its uniform buffer, and creates it again on return", () => {
        const device = new FakeGpuDevice();
        const caches = materialCaches(device);
        const kept = new Material("kept"), dropped = new Material("dropped");
        const droppedBuffer = caches.materials.prepare(dropped, true, NEAREST_TEXTURE_FILTERING, FRAME).uniformBuffer;
        caches.materials.prepare(kept, true, NEAREST_TEXTURE_FILTERING, FRAME);
        caches.materials.evictUnused(FRAME + EVICT_AFTER_FRAMES, EVICT_AFTER_FRAMES);
        expect(caches.materials.size).toBe(2);
        const evictionFrame = drawFramesUntilEviction(caches, kept);
        expect(caches.materials.size).toBe(1);
        expect((droppedBuffer as unknown as FakeGpuBuffer).destroyed).toBe(true);
        expect(device.liveBuffers().length).toBe(1);
        expect(caches.materials.prepare(dropped, true, NEAREST_TEXTURE_FILTERING, evictionFrame + 1).uniformBuffer).not.toBe(droppedBuffer);
        expect(device.buffers.length).toBe(3);
    });

    test("a texture no material has bound for more than the given frames is destroyed; a kept material's texture and the white one survive", () => {
        const device = new FakeGpuDevice();
        const caches = materialCaches(device);
        const kept = new Material("kept"), dropped = new Material("dropped");
        dropped.diffuseTexture = texture();
        kept.diffuseTexture = texture();
        caches.materials.prepare(dropped, true, NEAREST_TEXTURE_FILTERING, FRAME);
        caches.materials.prepare(kept, true, NEAREST_TEXTURE_FILTERING, FRAME);
        expect(device.textures.map(uploaded => uploaded.descriptor.label)).toEqual(["material texture", "white", "material texture"]);
        drawFramesUntilEviction(caches, kept);
        expect(device.textures.map(uploaded => uploaded.destroyed)).toEqual([true, false, false]);
        expect(caches.textures.size).toBe(1);
    });

    test("a texture a material stops binding is destroyed after the given frames, the one it binds now is kept", () => {
        const device = new FakeGpuDevice();
        const caches = materialCaches(device);
        const material = new Material("m");
        material.diffuseTexture = texture();
        caches.materials.prepare(material, true, NEAREST_TEXTURE_FILTERING, FRAME);
        material.diffuseTexture = texture();
        const evictionFrame = drawFramesUntilEviction(caches, material);
        expect(device.textures.map(uploaded => uploaded.destroyed)).toEqual([true, false, false]);
        expect(boundTexture(caches.materials.prepare(material, true, NEAREST_TEXTURE_FILTERING, evictionFrame + 1).bindGroup, MATERIAL_TEXTURE_BINDING))
            .toBe(device.textures[2].descriptor);
    });
});

describe("materialSamplerDescriptor", () => {
    test("nearest filters magnification, minification and mip levels by nearest texel, linear blends all three, both repeat", () => {
        const nearest = materialSamplerDescriptor(NEAREST_TEXTURE_FILTERING);
        const linear = materialSamplerDescriptor(LINEAR_TEXTURE_FILTERING);
        expect([nearest.magFilter, nearest.minFilter, nearest.mipmapFilter]).toEqual(["nearest", "nearest", "nearest"]);
        expect([linear.magFilter, linear.minFilter, linear.mipmapFilter]).toEqual(["linear", "linear", "linear"]);
        for (const descriptor of [nearest, linear]) expect([descriptor.addressModeU, descriptor.addressModeV]).toEqual(["repeat", "repeat"]);
    });

    test("an unknown filtering falls back to nearest", () => {
        expect(materialSamplerDescriptor(UNKNOWN_FILTERING).magFilter).toBe("nearest");
    });
});

describe("GpuPipelineCache", () => {
    test("one pipeline per shader, culling, format and sample count; software culling and winding; one module per shader", () => {
        const device = new FakeGpuDevice();
        const cache = new GpuPipelineCache(device, device.createPipelineLayout({bindGroupLayouts: []}));
        const back = cache.pipelineFor(BASIC_LIT, FaceCulling.BackFaces, FORMAT, MULTISAMPLE_COUNT, FRAME);
        expect(cache.pipelineFor(BASIC_LIT, FaceCulling.BackFaces, FORMAT, MULTISAMPLE_COUNT, FRAME)).toBe(back);
        cache.pipelineFor(BASIC_LIT, FaceCulling.None, FORMAT, MULTISAMPLE_COUNT, FRAME);
        cache.pipelineFor(BASIC_LIT, FaceCulling.BackFaces, FORMAT, SINGLE_SAMPLE_COUNT, FRAME);
        cache.pipelineFor(BASIC_LIT, FaceCulling.BackFaces, OTHER_FORMAT, MULTISAMPLE_COUNT, FRAME);
        expect(cache.size).toBe(4);
        expect(device.shaderModules.length).toBe(1);
        expect(device.pipelines.map(pipeline => [pipeline.primitive?.cullMode, pipeline.primitive?.frontFace, pipeline.multisample?.count])).toEqual([
            ["back", SOFTWARE_FRONT_FACE, MULTISAMPLE_COUNT],
            ["none", SOFTWARE_FRONT_FACE, MULTISAMPLE_COUNT],
            ["back", SOFTWARE_FRONT_FACE, SINGLE_SAMPLE_COUNT],
            ["back", SOFTWARE_FRONT_FACE, MULTISAMPLE_COUNT],
        ]);
        expect([cullModeOf(FaceCulling.BackFaces), cullModeOf(FaceCulling.FrontFaces), cullModeOf(FaceCulling.None)]).toEqual(["back", "front", "none"]);
        expect(device.pipelines[0].depthStencil?.depthCompare).toBe("greater");
    });

    test("drops the pipelines of shaders and keys unused for more than the given frames, keeping the ones drawn, and recompiles a dropped shader on return", async () => {
        const device = new FakeGpuDevice();
        const cache = pipelineCache(device);
        const library = new GpuShaderLibrary();
        const toon = await readyPipeline(cache, library.register(TOON, TOON_SOURCE));
        await readyPipeline(cache, library.register(PULSE, PULSE_SOURCE));
        cache.pipelineFor(BASIC_LIT, FaceCulling.None, FORMAT, MULTISAMPLE_COUNT, FRAME);
        expect(cache.size).toBe(4);
        const evictionFrame = FRAME + EVICT_AFTER_FRAMES + 1;
        for (let frame = FRAME + 1; frame <= evictionFrame; frame++) {
            expect(cache.pipelineFor(library.shaderNamed(TOON), FaceCulling.BackFaces, FORMAT, MULTISAMPLE_COUNT, frame)).toBe(toon);
            cache.evictUnused(frame, EVICT_AFTER_FRAMES);
        }
        expect(cache.size).toBe(1);
        const returning = cache.pipelineFor(library.shaderNamed(PULSE), FaceCulling.BackFaces, FORMAT, MULTISAMPLE_COUNT, evictionFrame + 1);
        expect(shaderNameOf(returning)).toBe(LIT_SURFACE_SHADER);
        expect(device.shaderModules.filter(module => module.label === PULSE).length).toBe(2);
    });
});

describe("GpuPipelineCache with custom surface shaders", () => {
    test("a custom shader draws with the built-in lit pipeline until its module compiles and its pipeline resolves, then with its own", async () => {
        const device = new FakeGpuDevice();
        const cache = pipelineCache(device);
        const toon = assembleSurfaceShader(TOON, TOON_SOURCE);
        expect(shaderNameOf(cache.pipelineFor(toon, FaceCulling.BackFaces, FORMAT, MULTISAMPLE_COUNT, FRAME))).toBe(LIT_SURFACE_SHADER);
        await settle();
        expect(shaderNameOf(cache.pipelineFor(toon, FaceCulling.BackFaces, FORMAT, MULTISAMPLE_COUNT, FRAME))).toBe(LIT_SURFACE_SHADER);
        await settle();
        const own = cache.pipelineFor(toon, FaceCulling.BackFaces, FORMAT, MULTISAMPLE_COUNT, FRAME);
        expect([shaderNameOf(own), codeOf(own)]).toEqual([TOON, toon.code]);
        expect(cache.pipelineFor(toon, FaceCulling.BackFaces, FORMAT, MULTISAMPLE_COUNT, FRAME)).toBe(own);
        expect([device.asyncPipelines.length, cache.size]).toEqual([1, 2]);
        expect(device.shaderModules.map(module => module.label)).toEqual([TOON, LIT_SURFACE_SHADER]);
    });

    test("the key includes the shader: two shaders at the same culling, format and samples get their own pipelines, one module each", async () => {
        const device = new FakeGpuDevice();
        const cache = pipelineCache(device);
        const library = new GpuShaderLibrary();
        const toon = await readyPipeline(cache, library.register(TOON, TOON_SOURCE));
        const pulse = await readyPipeline(cache, library.register(PULSE, PULSE_SOURCE));
        const lit = cache.pipelineFor(library.shaderNamed(LIT_SURFACE_SHADER), FaceCulling.BackFaces, FORMAT, MULTISAMPLE_COUNT, FRAME);
        expect([shaderNameOf(toon), shaderNameOf(pulse), shaderNameOf(lit)]).toEqual([TOON, PULSE, LIT_SURFACE_SHADER]);
        expect(new Set([toon, pulse, lit]).size).toBe(3);
        const toonUnculled = await readyPipeline(cache, library.shaderNamed(TOON), FaceCulling.None);
        expect([descriptorOf(toonUnculled).primitive?.cullMode, codeOf(toonUnculled)]).toEqual(["none", library.shaderNamed(TOON).code]);
        expect(device.shaderModules.filter(module => module.label === TOON).length).toBe(1);
    });

    test("re-registering a name replaces its shader: its pipelines are dropped, it draws lit while the new one compiles, then with the new code", async () => {
        const device = new FakeGpuDevice();
        const cache = pipelineCache(device);
        const library = new GpuShaderLibrary();
        const first = await readyPipeline(cache, library.register(PULSE, PULSE_SOURCE));
        expect(codeOf(first).endsWith(PULSE_SOURCE)).toBe(true);
        const sizeBefore = cache.size;
        library.register(PULSE, PULSE_FASTER_SOURCE);
        expect(shaderNameOf(cache.pipelineFor(library.shaderNamed(PULSE), FaceCulling.BackFaces, FORMAT, MULTISAMPLE_COUNT, FRAME))).toBe(LIT_SURFACE_SHADER);
        expect(cache.size).toBe(sizeBefore - 1);
        const second = await readyPipeline(cache, library.shaderNamed(PULSE));
        expect(second).not.toBe(first);
        expect(codeOf(second).endsWith(PULSE_FASTER_SOURCE)).toBe(true);
        expect(device.shaderModules.filter(module => module.label === PULSE).length).toBe(2);
    });

    test("a shader that does not compile logs one error with the shader name, the message and the offending line, and keeps drawing lit", async () => {
        const recorder = recordConsole();
        const device = new FakeGpuDevice();
        device.compilationMessages = code => code.includes(BROKEN_TOKEN) ? [compilationError(`unresolved value '${BROKEN_TOKEN}'`, lineOf(code, BROKEN_TOKEN), BROKEN_COLUMN)] : [];
        const cache = pipelineCache(device);
        const broken = assembleSurfaceShader(BROKEN, BROKEN_SOURCE);
        for (let frame = 0; frame < MANY_FRAMES; frame++) {
            expect(shaderNameOf(cache.pipelineFor(broken, FaceCulling.BackFaces, FORMAT, MULTISAMPLE_COUNT, FRAME))).toBe(LIT_SURFACE_SHADER);
            await settle();
        }
        expect(recorder.errors.length).toBe(1);
        const [error] = recorder.errors;
        const line = lineOf(broken.code, BROKEN_TOKEN);
        expect([error.includes(`"${BROKEN}"`), error.includes(`line ${line}:${BROKEN_COLUMN}: unresolved value '${BROKEN_TOKEN}'`), error.includes("return oops;")]).toEqual([true, true, true]);
        expect(device.asyncPipelines.length).toBe(0);
        expect(device.shaderModules.filter(module => module.label === BROKEN).length).toBe(1);
    });

    test("a pipeline that cannot be created logs one error and the shader keeps drawing lit", async () => {
        const recorder = recordConsole();
        const device = new FakeGpuDevice();
        device.pipelineCreationFailure = descriptor => descriptor.label?.startsWith(UNLINKABLE) ? PIPELINE_FAILURE : undefined;
        const cache = pipelineCache(device);
        const unlinkable = assembleSurfaceShader(UNLINKABLE, TOON_SOURCE);
        for (let frame = 0; frame < MANY_FRAMES; frame++) {
            expect(shaderNameOf(cache.pipelineFor(unlinkable, FaceCulling.BackFaces, FORMAT, MULTISAMPLE_COUNT, FRAME))).toBe(LIT_SURFACE_SHADER);
            expect(shaderNameOf(cache.pipelineFor(unlinkable, FaceCulling.None, FORMAT, MULTISAMPLE_COUNT, FRAME))).toBe(LIT_SURFACE_SHADER);
            await settle();
        }
        expect(recorder.errors.length).toBe(1);
        expect(recorder.errors[0].includes(`"${UNLINKABLE}"`) && recorder.errors[0].includes(PIPELINE_FAILURE)).toBe(true);
        expect(device.asyncPipelines.map(descriptor => descriptor.primitive?.cullMode)).toEqual(["back", "none"]);
    });
});
