import {Resource} from "../core";
import type {Component, ComponentCtor, Entity, World} from "../core";
import {ComponentType} from "../core/componentType";
import {NULL_ENTITY} from "../core/entity";
import type {EntityWriteOptions} from "../core/entityWriteOptions";
import {Parent} from "../translation/parent";
import type {SpriteImage} from "../rendering/2d/spriteImage";
import type {ComponentSchemaRegistry} from "./componentSchemaRegistry";
import {hasEntityFields, isEntityField} from "./fieldSchema";
import type {ComponentSchema, FieldSchema, FieldType} from "./fieldSchema";
import {assignFieldValue, decodeFieldValue} from "./fieldValueCodec";
import type {FieldDecodeContext} from "./fieldValueCodec";
import type {PrefabAsset} from "./prefabAsset";
import type {SceneAssetLoader} from "./sceneAssets";
import type {SceneDocument, SceneEntityRecord, SceneFieldValues, SceneJsonValue} from "./sceneDocument";
import {withoutSceneMembership} from "./sceneInstance";
import {PARENT_COMPONENT_NAME, withoutDetachedParents} from "./sceneSerialization";
import type {UnknownComponentTypePolicy} from "./sceneSerialization";
import {DEFAULT_SCHEMA_CHANGE_POLICY} from "./schemaChanges";
import type {SchemaChangePolicy} from "./schemaChanges";
import {unregisteredTypeMessage} from "./unregisteredType";

export interface PrefabSpawnerSettings {
    readonly unknownComponentTypes?: UnknownComponentTypePolicy;
    readonly schemaChanges?: SchemaChangePolicy;
}

interface FieldTemplate {
    readonly key: string;
    readonly decodedOnce: boolean;
    readonly value: unknown;
    readonly field: FieldSchema;
    readonly json: SceneJsonValue;
    readonly path: string;
}

interface EntityTemplate {
    readonly name: string | undefined;
    readonly enabled: boolean;
    readonly valueComponents: readonly ComponentTemplate[];
    readonly referringComponents: readonly ComponentTemplate[];
}

const NO_SETTINGS: PrefabSpawnerSettings = {};
const DEFAULT_UNKNOWN_COMPONENT_TYPE_POLICY: UnknownComponentTypePolicy = "throw";
const DISABLED = false;
const SINGLE_ROOT = 1;

function ignore(): void {
}

function fieldsOf(component: Component): Record<string, unknown> {
    return component as unknown as Record<string, unknown>;
}

function decodesToSharedValue(type: FieldType): boolean {
    switch (type.kind) {
        case "number":
        case "integer":
        case "boolean":
        case "string":
        case "enum":
        case "rgb":
        case "textColor":
        case "asset":
            return true;
        default:
            return false;
    }
}

class ComponentTemplate {
    public constructor(private readonly schema: ComponentSchema, private readonly fields: readonly FieldTemplate[]) {
    }

    public get ctor(): ComponentCtor<Component> {
        return this.schema.ctor;
    }

    public create(context: FieldDecodeContext): Component {
        const component = this.schema.create();
        for (const field of this.fields) {
            assignFieldValue(component, field.field, field.decodedOnce ? field.value : decodeFieldValue(field.field, field.json, context, field.path));
        }
        return component;
    }

    public createReferring(context: FieldDecodeContext): Component | undefined {
        const component = this.create(context);
        const values = fieldsOf(component);
        const missesRequiredEntity = this.schema.fields.some(field => isEntityField(field) && !field.nullable && values[field.key] === NULL_ENTITY);
        return missesRequiredEntity ? undefined : component;
    }
}

export class SpawnedPrefab {
    public constructor(
        public readonly sourcePath: string,
        public readonly entities: readonly Entity[],
        private readonly components: readonly (readonly Component[])[],
        private readonly rootIndex: number,
    ) {
    }

    public get root(): Entity {
        return this.entities[this.rootIndex];
    }

    public rootComponent<T extends Component>(ctor: ComponentCtor<T>): T {
        for (const component of this.components[this.rootIndex]) if (component.constructor === ctor) return component as T;
        throw new Error(`Prefab "${this.sourcePath}" has no ${ctor.name} on its root entity`);
    }
}

export class PrefabTemplate {
    private readonly indexBySceneId = new Map<number, number>();
    private readonly refersToEntities: boolean;
    private readonly rootDefaults = new Map<ComponentCtor<Component>, Component>();

    public constructor(
        public readonly sourcePath: string,
        sceneIds: readonly number[],
        private readonly entities: readonly EntityTemplate[],
        private readonly rootIndex: number,
        private readonly context: FieldDecodeContext,
    ) {
        sceneIds.forEach((sceneId, index) => this.indexBySceneId.set(sceneId, index));
        this.refersToEntities = entities.some(entity => entity.referringComponents.length > 0);
    }

    public rootComponentDefaults<T extends Component>(ctor: ComponentCtor<T>): Readonly<T> | undefined {
        let component = this.rootDefaults.get(ctor);
        if (component === undefined) {
            const template = this.entities[this.rootIndex].valueComponents.find(candidate => candidate.ctor === ctor);
            if (template === undefined) return undefined;
            component = template.create(this.context);
            this.rootDefaults.set(ctor, component);
        }
        return component as T;
    }

    public spawn(writer: EntityWriteOptions): SpawnedPrefab {
        const templates = this.entities;
        const entities: Entity[] = [];
        const components: Component[][] = [];
        for (const template of templates) {
            const created = template.valueComponents.map(component => component.create(this.context));
            components.push(created);
            entities.push(writer.createEntity(template.name, created));
        }
        if (this.refersToEntities) this.addReferringComponents(writer, entities, components);
        templates.forEach((template, index) => {
            if (!template.enabled) writer.setEnabledState(entities[index], DISABLED);
        });
        return new SpawnedPrefab(this.sourcePath, entities, components, this.rootIndex);
    }

    private addReferringComponents(writer: EntityWriteOptions, entities: readonly Entity[], components: Component[][]): void {
        const references: FieldDecodeContext = {
            ...this.context,
            entityOf: sceneId => {
                const index = this.indexBySceneId.get(sceneId);
                return index === undefined ? undefined : entities[index];
            },
        };
        this.entities.forEach((template, index) => {
            const referring: Component[] = [];
            for (const component of template.referringComponents) {
                const instance = component.createReferring(references);
                if (instance !== undefined) referring.push(instance);
            }
            if (referring.length === 0) return;
            writer.addComponents(entities[index], referring);
            components[index].push(...referring);
        });
    }
}

class PrefabCompiler {
    private readonly unknownComponentTypes: UnknownComponentTypePolicy;
    private readonly reportsSchemaChanges: boolean;
    private readonly context: FieldDecodeContext;
    private readonly droppedKeys: string[] = [];

    public constructor(private readonly registry: ComponentSchemaRegistry, assets: SceneAssetLoader, private readonly prefab: PrefabAsset, settings: PrefabSpawnerSettings) {
        this.unknownComponentTypes = settings.unknownComponentTypes ?? DEFAULT_UNKNOWN_COMPONENT_TYPE_POLICY;
        this.reportsSchemaChanges = (settings.schemaChanges ?? DEFAULT_SCHEMA_CHANGE_POLICY) === "report";
        this.context = {
            entityOf: () => undefined,
            reportDanglingEntity: ignore,
            assets,
            inlineSpriteImages: new Map<string, SpriteImage>(),
            fieldTypes: registry,
        };
    }

    public compile(): PrefabTemplate {
        const document = withoutDetachedParents(this.registry, withoutSceneMembership(this.prefab.document));
        const rootIndices = this.rootIndicesOf(document);
        if (rootIndices.length !== SINGLE_ROOT) {
            throw new Error(`Prefab "${this.prefab.sourcePath}" needs exactly one root entity; it has ${rootIndices.length}`);
        }
        const entities = document.entities.map((record, index) => this.entityTemplate(record, index));
        if (this.droppedKeys.length > 0) console.warn(`Prefab "${this.prefab.sourcePath}": left out fields its schemas no longer have: ${this.droppedKeys.join(", ")}`);
        return new PrefabTemplate(this.prefab.sourcePath, document.entities.map(record => record.id), entities, rootIndices[0], this.context);
    }

    private rootIndicesOf(document: SceneDocument): number[] {
        const parentName = this.registry.byType(ComponentType.of(Parent))?.name ?? PARENT_COMPONENT_NAME;
        const roots: number[] = [];
        document.entities.forEach((record, index) => {
            if (record.components[parentName] === undefined) roots.push(index);
        });
        return roots;
    }

    private label(index: number, componentName: string): string {
        return `Prefab "${this.prefab.sourcePath}" entities[${index}].components.${componentName}`;
    }

    private entityTemplate(record: SceneEntityRecord, index: number): EntityTemplate {
        const valueComponents: ComponentTemplate[] = [];
        const referringComponents: ComponentTemplate[] = [];
        for (const componentName of Object.keys(record.components)) {
            const schema = this.registry.byName(componentName);
            if (schema === undefined) {
                if (this.unknownComponentTypes === "skip" || this.registry.isOtherBackendTypeName(componentName)) continue;
                throw new Error(`${this.label(index, componentName)}: ${unregisteredTypeMessage("component", componentName)}`);
            }
            if (schema.persistence === "implied") continue;
            const template = new ComponentTemplate(schema, this.fieldTemplates(schema, record.components[componentName], this.label(index, componentName)));
            if (hasEntityFields(schema)) referringComponents.push(template);
            else valueComponents.push(template);
        }
        return {name: record.name ?? undefined, enabled: record.enabled, valueComponents, referringComponents};
    }

    private fieldTemplates(schema: ComponentSchema, json: SceneFieldValues, label: string): FieldTemplate[] {
        const unknownKeys = Object.keys(json).filter(key => !schema.fields.some(field => field.key === key));
        if (unknownKeys.length > 0 && !this.reportsSchemaChanges) {
            throw new Error(`${label}: ${schema.name} has no field${unknownKeys.length === 1 ? "" : "s"} ${unknownKeys.map(key => JSON.stringify(key)).join(", ")}`);
        }
        for (const key of unknownKeys) this.droppedKeys.push(`${schema.name}.${key}`);
        const templates: FieldTemplate[] = [];
        for (const field of schema.fields) {
            const fieldJson = json[field.key];
            if (fieldJson === undefined) continue;
            const path = `${label}.${field.key}`;
            const value = decodeFieldValue(field, fieldJson, this.context, path);
            const decodedOnce = decodesToSharedValue(field);
            templates.push({key: field.key, decodedOnce, value: decodedOnce ? value : undefined, field, json: fieldJson, path});
        }
        return templates;
    }
}

export class PrefabSpawner extends Resource {
    private readonly templates = new WeakMap<PrefabAsset, PrefabTemplate>();

    public constructor(
        private readonly registry: ComponentSchemaRegistry,
        private readonly assets: SceneAssetLoader,
        private readonly settings: PrefabSpawnerSettings = NO_SETTINGS,
    ) {
        super();
        const createdWithoutArguments = registry === undefined || assets === undefined;
        if (createdWithoutArguments) throw new Error("PrefabSpawner needs a schema registry and an asset loader; create it with prefabSpawnerOf(world, registry, assets)");
    }

    public templateOf(prefab: PrefabAsset): PrefabTemplate {
        let template = this.templates.get(prefab);
        if (template === undefined) {
            template = new PrefabCompiler(this.registry, this.assets, prefab, this.settings).compile();
            this.templates.set(prefab, template);
        }
        return template;
    }

    public spawn(writer: EntityWriteOptions, prefab: PrefabAsset): SpawnedPrefab {
        return this.templateOf(prefab).spawn(writer);
    }
}

export function prefabSpawnerOf(world: World, registry: ComponentSchemaRegistry, assets: SceneAssetLoader, settings: PrefabSpawnerSettings = NO_SETTINGS): PrefabSpawner {
    return world.resources.tryGet(PrefabSpawner) ?? world.resources.insert(new PrefabSpawner(registry, assets, settings));
}
