import {Resource} from "../core";
import type {World} from "../core";
import type {ResourceCtor} from "../core/resource";
import type {AssetLoadOptions} from "../platform/platform";
import {normalizePath} from "../platform/paths";
import type {SpriteImage} from "../rendering/2d/spriteImage";
import {Event} from "../util/event";
import type {ComponentSchemaRegistry} from "./componentSchemaRegistry";
import {dataAssetDocumentText, newDataAssetDocument, parseDataAssetDocument, rememberDataAssetPath} from "./dataAssetDocument";
import type {DataAssetDocument} from "./dataAssetDocument";
import {hasEntityFields} from "./fieldSchema";
import type {ResourceSchema} from "./fieldSchema";
import {assignFieldValue, decodeFieldValue, encodeFieldValue} from "./fieldValueCodec";
import type {FieldDecodeContext, FieldEncodeContext} from "./fieldValueCodec";
import {platformSceneAssetLoader} from "./sceneAssets";
import type {SceneAssetLoader} from "./sceneAssets";
import type {SceneFieldValues} from "./sceneDocument";
import {DEFAULT_SCHEMA_CHANGE_POLICY, SchemaChangeCollector} from "./schemaChanges";
import type {SchemaChange, SchemaChangePolicy} from "./schemaChanges";

export interface DataAssetReloaded {
    readonly path: string;
    readonly asset: Resource;
}

export interface DataAssetSchemaChanges {
    readonly path: string;
    readonly changes: readonly SchemaChange[];
}

export interface DataAssetsSettings {
    readonly schemaChanges?: SchemaChangePolicy;
}

interface DecodedDataAsset {
    readonly asset: Resource;
    readonly changes: readonly SchemaChange[];
}

const NO_SCHEMA_CHANGES: readonly SchemaChange[] = [];
const NO_SETTINGS: DataAssetsSettings = {};

function ignore(): void {
}

function fieldsOf(target: object): Record<string, unknown> {
    return target as Record<string, unknown>;
}

function resourceCtorOf(asset: Resource): ResourceCtor<Resource> {
    return asset.constructor as ResourceCtor<Resource>;
}

function requireNoEntityFields(schema: ResourceSchema, label: string): void {
    if (hasEntityFields(schema)) throw new Error(`${label}: ${schema.name} has entity fields, which a data asset cannot hold`);
}

function unknownFieldsError(label: string, schema: ResourceSchema, unknownKeys: readonly string[]): Error {
    return new Error(`${label}: ${schema.name} has no field${unknownKeys.length === 1 ? "" : "s"} ${unknownKeys.map(key => JSON.stringify(key)).join(", ")}`);
}

function dataAssetSchemaOf(registry: ComponentSchemaRegistry, asset: Resource, label: string): ResourceSchema {
    const ctor = resourceCtorOf(asset);
    const schema = registry.resourceByCtor(ctor);
    if (schema === undefined) throw new Error(`${label}: ${ctor.name} has no registered resource schema`);
    requireNoEntityFields(schema, label);
    return schema;
}

function encodeFields(registry: ComponentSchemaRegistry, schema: ResourceSchema, asset: Resource): SceneFieldValues {
    const context: FieldEncodeContext = {
        sceneIdOf: () => undefined,
        reportDanglingEntity: ignore,
        reportUnsavedAsset: ignore,
        inlineSpriteImageEncodings: new Map<SpriteImage, string>(),
        fieldTypes: registry,
    };
    const values = fieldsOf(asset);
    const fields: SceneFieldValues = {};
    for (const field of schema.fields) fields[field.key] = encodeFieldValue(field, values[field.key], context, `${schema.name}.${field.key}`);
    return fields;
}

export function encodeDataAssetFields(registry: ComponentSchemaRegistry, asset: Resource): SceneFieldValues {
    return encodeFields(registry, dataAssetSchemaOf(registry, asset, "encodeDataAssetFields"), asset);
}

export function serializeDataAsset(registry: ComponentSchemaRegistry, asset: Resource): string {
    const schema = dataAssetSchemaOf(registry, asset, "serializeDataAsset");
    return dataAssetDocumentText(newDataAssetDocument(schema.name, encodeFields(registry, schema, asset)));
}

export class DataAssets extends Resource {
    public readonly onReloaded = new Event<DataAssetReloaded>();
    public readonly onSchemaChanged = new Event<DataAssetSchemaChanges>();
    public readonly assets: SceneAssetLoader;
    public readonly schemaChanges: SchemaChangePolicy;
    private readonly loaded = new Map<string, Resource>();
    private readonly changesByPath = new Map<string, readonly SchemaChange[]>();

    public constructor(private readonly registry: ComponentSchemaRegistry, private readonly options: AssetLoadOptions, settings: DataAssetsSettings = NO_SETTINGS) {
        super();
        const createdWithoutArguments = registry === undefined || options === undefined;
        if (createdWithoutArguments) throw new Error("DataAssets needs a schema registry and asset load options; create it with dataAssetsOf(world, registry)");
        this.schemaChanges = settings.schemaChanges ?? DEFAULT_SCHEMA_CHANGE_POLICY;
        this.assets = platformSceneAssetLoader(options, this);
    }

    public isLoaded(path: string): boolean {
        return this.loaded.has(normalizePath(path));
    }

    public schemaChangesOf(path: string): readonly SchemaChange[] {
        return this.changesByPath.get(normalizePath(path)) ?? NO_SCHEMA_CHANGES;
    }

    public schemaChangeReports(): DataAssetSchemaChanges[] {
        return [...this.changesByPath].map(([path, changes]) => ({path, changes}));
    }

    public load<R extends Resource>(path: string, type?: ResourceCtor<R>): R {
        const key = normalizePath(path);
        const cached = this.loaded.get(key);
        if (cached !== undefined) {
            this.requireType(key, this.schemaOfInstance(cached).name, type);
            return cached as R;
        }
        const document = this.read(key);
        this.requireType(key, document.type, type);
        const decoded = this.decode(key, document);
        this.loaded.set(key, decoded.asset);
        rememberDataAssetPath(decoded.asset, key);
        this.recordSchemaChanges(key, decoded.changes);
        return decoded.asset as R;
    }

    public reload(path: string): Resource | undefined {
        const key = normalizePath(path);
        const asset = this.loaded.get(key);
        if (asset === undefined) return undefined;
        const document = this.read(key);
        const schema = this.schemaOfInstance(asset);
        if (document.type !== schema.name) {
            throw new Error(`Data asset "${key}": expected a ${schema.name}, but the file now holds a ${document.type}`);
        }
        const decoded = this.decode(key, document);
        const fresh = fieldsOf(decoded.asset);
        for (const field of schema.fields) assignFieldValue(asset, field, fresh[field.key]);
        this.recordSchemaChanges(key, decoded.changes);
        this.onReloaded.invoke({path: key, asset});
        return asset;
    }

    public serialize(asset: Resource): string {
        return serializeDataAsset(this.registry, asset);
    }

    private recordSchemaChanges(path: string, changes: readonly SchemaChange[]): void {
        if (changes.length === 0) {
            this.changesByPath.delete(path);
            return;
        }
        this.changesByPath.set(path, changes);
        this.onSchemaChanged.invoke({path, changes});
    }

    private read(path: string): DataAssetDocument {
        if (!this.options.files.exists(path)) throw new Error(`Data asset "${path}" does not exist`);
        return parseDataAssetDocument(this.options.files.readText(path), path);
    }

    private schemaOfInstance(asset: Resource): ResourceSchema {
        const ctor = resourceCtorOf(asset);
        const schema = this.registry.resourceByCtor(ctor);
        if (schema === undefined) throw new Error(`DataAssets: ${ctor.name} has no registered resource schema`);
        return schema;
    }

    private requireType(path: string, actualName: string, type: ResourceCtor<Resource> | undefined): void {
        if (type === undefined) return;
        const expectedName = this.registry.resourceByCtor(type)?.name ?? type.name;
        if (expectedName !== actualName) throw new Error(`Data asset "${path}": expected a ${expectedName}, but the file holds a ${actualName}`);
    }

    private decode(path: string, document: DataAssetDocument): DecodedDataAsset {
        const label = `Data asset "${path}"`;
        const schema = this.registry.resourceByName(document.type);
        if (schema === undefined) throw new Error(`${label}: the resource type "${document.type}" is not registered`);
        requireNoEntityFields(schema, label);
        const reportsSchemaChanges = this.schemaChanges === "report";
        const unknownKeys = Object.keys(document.fields).filter(key => !schema.fields.some(field => field.key === key));
        if (!reportsSchemaChanges && unknownKeys.length > 0) throw unknownFieldsError(label, schema, unknownKeys);
        const collector = new SchemaChangeCollector();
        const context: FieldDecodeContext = {
            entityOf: () => undefined,
            reportDanglingEntity: ignore,
            assets: this.assets,
            inlineSpriteImages: new Map<string, SpriteImage>(),
            fieldTypes: this.registry,
        };
        if (reportsSchemaChanges) {
            const addedKeys = schema.fields.filter(field => document.fields[field.key] === undefined).map(field => field.key);
            collector.add(schema.name, addedKeys, unknownKeys);
            context.reportSchemaChange = (typeName, nestedAddedKeys, nestedRemovedKeys) => collector.add(typeName, nestedAddedKeys, nestedRemovedKeys);
        }
        const decoded = schema.fields
            .filter(field => document.fields[field.key] !== undefined)
            .map(field => ({key: field.key, value: decodeFieldValue(field, document.fields[field.key], context, `${path} ${schema.name}.${field.key}`)}));
        const asset = schema.create();
        const values = fieldsOf(asset);
        for (const {key, value} of decoded) values[key] = value;
        return {asset, changes: collector.list()};
    }
}

export function dataAssetsOf(world: World, registry: ComponentSchemaRegistry, options: AssetLoadOptions = world.platform, settings: DataAssetsSettings = NO_SETTINGS): DataAssets {
    return world.resources.tryGet(DataAssets) ?? world.resources.insert(new DataAssets(registry, options, settings));
}
