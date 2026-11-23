import {Resource} from "../core";
import type {Component, ComponentCtor, Entity, World} from "../core";
import {ComponentType} from "../core/componentType";
import type {EntityWriteOptions} from "../core/entityWriteOptions";
import {Parent} from "../translation/parent";
import type {SpriteImage} from "../rendering/2d/spriteImage";
import type {ComponentSchemaRegistry} from "./componentSchemaRegistry";
import {hasEntityFields} from "./fieldSchema";
import type {ComponentSchema} from "./fieldSchema";
import {decodeFieldValue} from "./fieldValueCodec";
import type {FieldDecodeContext} from "./fieldValueCodec";
import type {PrefabAsset} from "./prefabAsset";
import {compileComponentSpawnPlan, NO_SPAWNED_ENTITIES} from "./prefabSpawnPlan";
import type {AuthoredField, ComponentSpawnPlan, PrefabFieldScope} from "./prefabSpawnPlan";
import type {SceneAssetLoader} from "./sceneAssets";
import type {SceneDocument, SceneEntityRecord, SceneFieldValues} from "./sceneDocument";
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

interface EntitySpawnPlan {
    readonly name: string | undefined;
    readonly enabled: boolean;
    readonly valueComponents: readonly ComponentSpawnPlan[];
    readonly referringComponents: readonly ComponentSpawnPlan[];
}

const NO_SETTINGS: PrefabSpawnerSettings = {};
const DEFAULT_UNKNOWN_COMPONENT_TYPE_POLICY: UnknownComponentTypePolicy = "throw";
const DISABLED = false;
const SINGLE_ROOT = 1;

function ignore(): void {
}

export class SpawnedPrefab {
    public constructor(
        public readonly sourcePath: string,
        public readonly entities: readonly Entity[],
        private readonly rootComponents: readonly Component[],
        private readonly rootIndex: number,
    ) {
    }

    public get root(): Entity {
        return this.entities[this.rootIndex];
    }

    public rootComponent<T extends Component>(ctor: ComponentCtor<T>): T {
        for (const component of this.rootComponents) if (component.constructor === ctor) return component as T;
        throw new Error(`Prefab "${this.sourcePath}" has no ${ctor.name} on its root entity`);
    }
}

export class PrefabTemplate {
    private readonly refersToEntities: boolean;
    private readonly disabledIndices: readonly number[];
    private readonly rootDefaults = new Map<ComponentCtor<Component>, Component>();

    public constructor(public readonly sourcePath: string, private readonly entities: readonly EntitySpawnPlan[], private readonly rootIndex: number) {
        this.refersToEntities = entities.some(entity => entity.referringComponents.length > 0);
        const disabledIndices: number[] = [];
        entities.forEach((entity, index) => {
            if (!entity.enabled) disabledIndices.push(index);
        });
        this.disabledIndices = disabledIndices;
    }

    public rootComponentDefaults<T extends Component>(ctor: ComponentCtor<T>): Readonly<T> | undefined {
        let component = this.rootDefaults.get(ctor);
        if (component === undefined) {
            const plan = this.entities[this.rootIndex].valueComponents.find(candidate => candidate.ctor === ctor);
            if (plan === undefined) return undefined;
            component = plan.create(NO_SPAWNED_ENTITIES);
            this.rootDefaults.set(ctor, component);
        }
        return component as T;
    }

    public spawn(writer: EntityWriteOptions): SpawnedPrefab {
        const plans = this.entities, rootIndex = this.rootIndex;
        const entities: Entity[] = [];
        const rootComponents: Component[] = [];
        for (let index = 0; index < plans.length; index++) {
            const plan = plans[index];
            const valuePlans = plan.valueComponents;
            const created = index === rootIndex ? rootComponents : [];
            for (let i = 0; i < valuePlans.length; i++) created.push(valuePlans[i].create(NO_SPAWNED_ENTITIES));
            entities.push(writer.createEntity(plan.name, created));
        }
        if (this.refersToEntities) this.addReferringComponents(writer, entities, rootComponents);
        const disabledIndices = this.disabledIndices;
        for (let i = 0; i < disabledIndices.length; i++) writer.setEnabledState(entities[disabledIndices[i]], DISABLED);
        return new SpawnedPrefab(this.sourcePath, entities, rootComponents, rootIndex);
    }

    private addReferringComponents(writer: EntityWriteOptions, entities: readonly Entity[], rootComponents: Component[]): void {
        const plans = this.entities;
        for (let index = 0; index < plans.length; index++) {
            const referringPlans = plans[index].referringComponents;
            if (referringPlans.length === 0) continue;
            const referring: Component[] = [];
            for (const plan of referringPlans) {
                const instance = plan.createReferring(entities);
                if (instance !== undefined) referring.push(instance);
            }
            if (referring.length === 0) continue;
            writer.addComponents(entities[index], referring);
            if (index === this.rootIndex) rootComponents.push(...referring);
        }
    }
}

class PrefabCompiler implements PrefabFieldScope {
    public readonly context: FieldDecodeContext;
    private readonly unknownComponentTypes: UnknownComponentTypePolicy;
    private readonly reportsSchemaChanges: boolean;
    private readonly droppedKeys: string[] = [];
    private readonly indexBySceneId = new Map<number, number>();

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

    public entityIndexOf(sceneId: number): number | undefined {
        return this.indexBySceneId.get(sceneId);
    }

    public compile(): PrefabTemplate {
        const document = withoutDetachedParents(this.registry, withoutSceneMembership(this.prefab.document));
        const rootIndices = this.rootIndicesOf(document);
        if (rootIndices.length !== SINGLE_ROOT) {
            throw new Error(`Prefab "${this.prefab.sourcePath}" needs exactly one root entity; it has ${rootIndices.length}`);
        }
        document.entities.forEach((record, index) => this.indexBySceneId.set(record.id, index));
        const entities = document.entities.map((record, index) => this.entitySpawnPlan(record, index));
        if (this.droppedKeys.length > 0) console.warn(`Prefab "${this.prefab.sourcePath}": left out fields its schemas no longer have: ${this.droppedKeys.join(", ")}`);
        return new PrefabTemplate(this.prefab.sourcePath, entities, rootIndices[0]);
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

    private entitySpawnPlan(record: SceneEntityRecord, index: number): EntitySpawnPlan {
        const valueComponents: ComponentSpawnPlan[] = [];
        const referringComponents: ComponentSpawnPlan[] = [];
        for (const componentName of Object.keys(record.components)) {
            const schema = this.registry.byName(componentName);
            if (schema === undefined) {
                if (this.unknownComponentTypes === "skip" || this.registry.isOtherBackendTypeName(componentName)) continue;
                throw new Error(`${this.label(index, componentName)}: ${unregisteredTypeMessage("component", componentName)}`);
            }
            if (schema.persistence === "implied") continue;
            const plan = compileComponentSpawnPlan(schema, this.authoredFields(schema, record.components[componentName], this.label(index, componentName)), this);
            if (hasEntityFields(schema)) referringComponents.push(plan);
            else valueComponents.push(plan);
        }
        return {name: record.name ?? undefined, enabled: record.enabled, valueComponents, referringComponents};
    }

    private authoredFields(schema: ComponentSchema, json: SceneFieldValues, label: string): AuthoredField[] {
        const unknownKeys = Object.keys(json).filter(key => !schema.fields.some(field => field.key === key));
        if (unknownKeys.length > 0 && !this.reportsSchemaChanges) {
            throw new Error(`${label}: ${schema.name} has no field${unknownKeys.length === 1 ? "" : "s"} ${unknownKeys.map(key => JSON.stringify(key)).join(", ")}`);
        }
        for (const key of unknownKeys) this.droppedKeys.push(`${schema.name}.${key}`);
        const authored: AuthoredField[] = [];
        for (const field of schema.fields) {
            const fieldJson = json[field.key];
            if (fieldJson === undefined) continue;
            const path = `${label}.${field.key}`;
            authored.push({field, json: fieldJson, decoded: decodeFieldValue(field, fieldJson, this.context, path), path});
        }
        return authored;
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
