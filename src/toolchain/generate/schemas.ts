import * as ts from "typescript";
import {PROJECT_MANIFEST_FILE, SCHEMAS_MANIFEST_KEY} from "../../engine/project/projectManifest";
import {RENDER_BACKEND_KINDS} from "../../engine/rendering/renderBackend";
import type {RenderBackendKind} from "../../engine/rendering/renderBackend";
import {ENGINE_ASSET_TYPES} from "../../engine/scene/assetTypes";
import {STATIC_SCHEMA_KEY} from "../../engine/scene/fieldSchema";
import {
    GENERATED_SCHEMAS_EXPORT,
    GENERATED_SCHEMAS_FILE,
    generatedBackendSchemasExport,
    generatedBackendSchemasFile,
} from "../projectLayout";
import type {CatalogSchema, SourceExport} from "./engineCatalog";
import {generatedFileHeader} from "./generatedHeader";
import type {GeneratedSource, ProjectGenerator} from "./generatedHeader";
import {ImportTable} from "./generatedImports";
import {compareText, DEFAULT_EXPORT_NAME, isInside, ProjectSources, SOURCE_EXTENSION_PATTERN} from "./projectSources";
import type {ExportReference} from "./projectSources";
import {projectReachability} from "./reachability";
import type {ProjectReachability, ProjectSchemaSummary} from "./reachability";

export const SCHEMAS_GENERATOR_NAME = "schemas";
export const SCHEMAS_GENERATOR_VERSION = 4;
export const GENERATED_HEADER = generatedFileHeader(SCHEMAS_GENERATOR_NAME, SCHEMAS_GENERATOR_VERSION);
export const UNSUPPORTED_TYPE_WARNING = "unsupported type";
export const RECURSIVE_TYPE_WARNING = "recursive type";
export const STATIC_CATEGORY_KEY = "category";
export const STATIC_FIELD_TYPE_KEY = "fieldType";
export const CATEGORY_NOT_LITERAL_WARNING = "the static category is not a string literal";
export const RESOURCE_CATEGORY_WARNING = "resources have no category";
export const FIELD_TYPE_CODEC_WARNING = "needs encode, decode and defaultValue";
export const FIELD_TYPE_NOT_EXPORTED_WARNING = "is not exported, so the schema list cannot register its field type";
export const UNMATCHED_EXCLUDE_WARNING = "matches no component, resource, field alias or field type";

const LINE_BREAK = "\r\n";
const INDENT = "    ";
const ENGINE_SCENE_MODULE = "scene";
const PRIVATE_NAME_PREFIX = "_";
const ARRAY_ELEMENT_SUFFIX = "[]";
const SCHEMA_ENTRY_TYPE = "SchemaEntry";
const OTHER_BACKEND_TYPES_KIND = "otherBackendTypes";
const ENGINE_COMPONENT_CLASS = "Component";
const ENGINE_RESOURCE_CLASS = "Resource";
const ENGINE_FIELD_ALIAS_TYPE = "FieldAlias";
const ENGINE_VEC_ALIAS = "Vec";
const FIELD_TYPE_CODEC_MEMBERS: readonly string[] = ["encode", "decode", "defaultValue"];
const NO_EXCLUDED_NAMES: readonly string[] = [];

const UNSUPPORTED = "unsupported";
const SKIPPED = "skipped";

type SchemaRole = "component" | "resource";
type FieldTypingKind = "fieldAlias" | "fieldType";
type EnumValue = string | number;
type Unmapped = typeof UNSUPPORTED | typeof SKIPPED;

interface EnumMember {
    readonly name: string;
    readonly value: EnumValue;
}

type GeneratedType =
    | {readonly kind: "number"; readonly nullable?: boolean; readonly typeName?: string}
    | {readonly kind: "integer"; readonly nullable?: boolean; readonly typeName?: string}
    | {readonly kind: "boolean" | "textLines" | "vec2" | "vec3" | "rotation" | "rgb" | "textColor"}
    | {readonly kind: "string"; readonly nullable: boolean; readonly typeName?: string}
    | {readonly kind: "enum"; readonly members: readonly EnumMember[]; readonly typeName?: string}
    | {readonly kind: "entity"; readonly nullable: boolean}
    | {readonly kind: "asset"; readonly assetType: string}
    | {readonly kind: "list"; readonly element: GeneratedType}
    | {readonly kind: "struct"; readonly nullable?: boolean; readonly typeName?: string; readonly create?: ExportReference; readonly fields: readonly GeneratedField[]}
    | {readonly kind: "custom"; readonly typeName: string};

type GeneratedField = GeneratedType & {readonly key: string};

type Mapped = GeneratedType | Unmapped;

interface SchemaClass {
    readonly role: SchemaRole;
    readonly className: string;
    readonly reference: ExportReference;
    readonly relativeFile: string;
    readonly symbol: ts.Symbol;
    readonly hasOwnSchema: boolean;
    readonly category?: string;
}

interface FieldTyping {
    readonly kind: FieldTypingKind;
    readonly typeName: string;
    readonly reference: ExportReference;
    readonly relativeFile: string;
}

interface GeneratedSchema {
    readonly schemaClass: SchemaClass;
    readonly fields: readonly GeneratedField[];
}

export interface ProjectSchemaAnalysis {
    readonly typings: readonly FieldTyping[];
    readonly schemas: readonly GeneratedSchema[];
    readonly warnings: readonly string[];
    readonly summary: ProjectSchemaSummary;
}

export interface GenerateProjectSchemasOptions {
    readonly repoRoot: string;
    readonly exclude?: readonly string[];
}

export interface GeneratedProjectSchemas {
    readonly source: string;
    readonly warnings: readonly string[];
}

const ENGINE_ASSET_VALUE_TYPES: readonly (readonly [string, GeneratedType])[] = ENGINE_ASSET_TYPES.map(type => [type.valueName, {kind: "asset", assetType: type.name}]);

const ENGINE_NAMED_TYPES: ReadonlyMap<string, GeneratedType> = new Map<string, GeneratedType>([
    ["Int", {kind: "integer"}],
    ["Rgb", {kind: "rgb"}],
    ["TextLines", {kind: "textLines"}],
    ["Quat", {kind: "rotation"}],
    ["TextColor", {kind: "textColor"}],
    ["TextColorBrand", {kind: "textColor"}],
    ["Vec2", {kind: "vec2"}],
    ["Vec3", {kind: "vec3"}],
    ["Vec4", {kind: "rotation"}],
    ["Entity", {kind: "entity", nullable: true}],
    ["EntityBrandEnum", {kind: "entity", nullable: true}],
    ...ENGINE_ASSET_VALUE_TYPES,
]);

const VEC_TYPES_BY_LENGTH: ReadonlyMap<number, GeneratedType> = new Map<number, GeneratedType>([
    [2, {kind: "vec2"}],
    [3, {kind: "vec3"}],
    [4, {kind: "rotation"}],
]);

const UNMAPPABLE_TYPE_FLAGS = ts.TypeFlags.Any | ts.TypeFlags.Unknown | ts.TypeFlags.Never | ts.TypeFlags.Void
    | ts.TypeFlags.Undefined | ts.TypeFlags.Null | ts.TypeFlags.ESSymbolLike | ts.TypeFlags.BigIntLike;
const NULLISH_TYPE_FLAGS = ts.TypeFlags.Undefined | ts.TypeFlags.Null | ts.TypeFlags.Void;
const LITERAL_TYPE_FLAGS = ts.TypeFlags.StringLiteral | ts.TypeFlags.NumberLiteral;
const EXCLUDED_MEMBER_MODIFIERS = ts.ModifierFlags.Private | ts.ModifierFlags.Protected | ts.ModifierFlags.Static;
const VECTOR_KINDS: ReadonlySet<GeneratedType["kind"]> = new Set<GeneratedType["kind"]>(["vec2", "vec3", "rotation"]);
const ACCESSOR_PAIR = ts.SymbolFlags.GetAccessor | ts.SymbolFlags.SetAccessor;

function isNullishTypeNode(node: ts.TypeNode): boolean {
    if (node.kind === ts.SyntaxKind.UndefinedKeyword || node.kind === ts.SyntaxKind.VoidKeyword) return true;
    return ts.isLiteralTypeNode(node) && node.literal.kind === ts.SyntaxKind.NullKeyword;
}

function literalValueOfNode(node: ts.TypeNode): EnumValue | undefined {
    if (!ts.isLiteralTypeNode(node)) return undefined;
    const literal = node.literal;
    if (ts.isStringLiteral(literal)) return literal.text;
    if (ts.isNumericLiteral(literal)) return Number(literal.text);
    const isNegativeNumber = ts.isPrefixUnaryExpression(literal) && literal.operator === ts.SyntaxKind.MinusToken && ts.isNumericLiteral(literal.operand);
    return isNegativeNumber ? -Number((literal.operand as ts.NumericLiteral).text) : undefined;
}

function literalMembers(values: readonly EnumValue[]): EnumMember[] {
    return values.map(value => ({name: String(value), value}));
}

function typeNodeOf(symbol: ts.Symbol): ts.TypeNode | undefined {
    for (const declaration of symbol.declarations ?? []) {
        const hasOwnTypeNode = ts.isPropertyDeclaration(declaration) || ts.isPropertySignature(declaration)
            || ts.isParameter(declaration) || ts.isGetAccessorDeclaration(declaration);
        if (hasOwnTypeNode && declaration.type !== undefined) return declaration.type;
        if (ts.isSetAccessorDeclaration(declaration) && declaration.parameters[0]?.type !== undefined) return declaration.parameters[0].type;
    }
    return undefined;
}

function hasPrivateIdentifier(symbol: ts.Symbol): boolean {
    return (symbol.declarations ?? []).some(declaration => {
        const name = ts.getNameOfDeclaration(declaration);
        return name !== undefined && ts.isPrivateIdentifier(name);
    });
}

function modifierFlagsOf(symbol: ts.Symbol): ts.ModifierFlags {
    let flags = ts.ModifierFlags.None;
    for (const declaration of symbol.declarations ?? []) flags |= ts.getCombinedModifierFlags(declaration);
    return flags;
}

function isDataMember(symbol: ts.Symbol): boolean {
    if (symbol.name.startsWith(PRIVATE_NAME_PREFIX) || hasPrivateIdentifier(symbol)) return false;
    const isProperty = (symbol.flags & ts.SymbolFlags.Property) !== 0;
    const isAccessorPair = (symbol.flags & ACCESSOR_PAIR) === ACCESSOR_PAIR;
    if (!isProperty && !isAccessorPair) return false;
    return (modifierFlagsOf(symbol) & EXCLUDED_MEMBER_MODIFIERS) === 0;
}

function isReadonlyMember(symbol: ts.Symbol): boolean {
    return (modifierFlagsOf(symbol) & ts.ModifierFlags.Readonly) !== 0;
}

function supportsTypeName(type: GeneratedType): boolean {
    switch (type.kind) {
        case "number":
        case "integer":
        case "string":
        case "enum":
        case "struct":
            return true;
        default:
            return false;
    }
}

function withTypeName(mapped: GeneratedType, typeName: string): GeneratedType {
    return supportsTypeName(mapped) ? {...mapped, typeName} as GeneratedType : mapped;
}

function asNullable(mapped: Mapped): Mapped {
    if (mapped === UNSUPPORTED || mapped === SKIPPED) return mapped;
    switch (mapped.kind) {
        case "number":
        case "integer":
        case "string":
        case "struct":
            return {...mapped, nullable: true};
        case "asset":
        case "entity":
            return mapped;
        default:
            return UNSUPPORTED;
    }
}

class SchemaGenerator {
    private readonly checker: ts.TypeChecker;
    private readonly program: ts.Program;
    private readonly warnings: string[] = [];
    private readonly expanding = new Set<ts.Type>();
    private readonly unexportedFieldTypes = new Set<ts.Symbol>();

    public constructor(private readonly sources: ProjectSources) {
        this.checker = sources.checker;
        this.program = sources.program;
    }

    public analyze(files: readonly string[], exclude: readonly string[]): ProjectSchemaAnalysis {
        const schemaClasses = this.uniqueByName(files.flatMap(file => this.schemaClassesIn(file)), schemaClass => schemaClass.className);
        const fieldTypings = this.uniqueByName(files.flatMap(file => this.fieldTypingsIn(file)), typing => typing.typeName);
        const excluded = new Set(exclude);
        const matched = new Set<string>();
        const isKept = (name: string): boolean => {
            if (!excluded.has(name)) return true;
            matched.add(name);
            return false;
        };
        const keptTypings = fieldTypings.filter(typing => isKept(typing.typeName));
        const keptClasses = schemaClasses.filter(schemaClass => isKept(schemaClass.className));
        for (const name of exclude) {
            if (!matched.has(name)) this.warn(`${SCHEMAS_MANIFEST_KEY}.exclude: "${name}" ${UNMATCHED_EXCLUDE_WARNING}; remove it from ${PROJECT_MANIFEST_FILE}`);
        }
        const schemas = keptClasses.map(schemaClass => ({schemaClass, fields: schemaClass.hasOwnSchema ? [] : this.schemaFields(schemaClass)}));
        return {typings: keptTypings, schemas, warnings: this.warnings, summary: summaryOf(schemas)};
    }

    private warn(message: string): void {
        this.warnings.push(message);
    }

    private relativeFile(fileName: string): string {
        return this.sources.relativeFile(fileName);
    }

    private schemaClassesIn(file: string): SchemaClass[] {
        const found: SchemaClass[] = [];
        for (const exported of this.sources.exportedClassesIn(file)) {
            const {symbol, className, relativeFile, reference} = exported;
            const role = this.schemaRoleOf(symbol);
            if (exported.isAbstract || role === undefined) continue;
            if (exported.isDefaultExport) {
                this.warn(`${className}: default-exported classes are skipped; export it by name (${relativeFile})`);
                continue;
            }
            const hasOwnSchema = symbol.exports?.has(STATIC_SCHEMA_KEY as ts.__String) === true;
            const category = hasOwnSchema ? undefined : this.staticCategoryOf(symbol, role, className, relativeFile);
            found.push({role, className, relativeFile, symbol, reference, hasOwnSchema, ...(category === undefined ? {} : {category})});
        }
        return found.sort((a, b) => compareText(a.className, b.className));
    }

    private fieldTypingsIn(file: string): FieldTyping[] {
        const sourceFile = this.program.getSourceFile(file);
        const moduleSymbol = sourceFile && this.checker.getSymbolAtLocation(sourceFile);
        if (sourceFile === undefined || moduleSymbol === undefined) return [];
        const relativeFile = this.relativeFile(sourceFile.fileName);
        const found: FieldTyping[] = [];
        for (const exported of this.checker.getExportsOfModule(moduleSymbol)) {
            if (exported.name === DEFAULT_EXPORT_NAME) continue;
            const symbol = this.resolveAlias(exported);
            const isDeclaredHere = symbol.valueDeclaration?.getSourceFile() === sourceFile;
            const kind = isDeclaredHere ? this.fieldTypingKindOf(symbol, relativeFile) : undefined;
            if (kind === undefined) continue;
            const typeName = kind === "fieldType" ? symbol.name : exported.name;
            found.push({kind, typeName, relativeFile, reference: {fileName: sourceFile.fileName, exportName: exported.name}});
        }
        return found.sort((a, b) => compareText(a.typeName, b.typeName));
    }

    private fieldTypingKindOf(symbol: ts.Symbol, relativeFile: string): FieldTypingKind | undefined {
        if ((symbol.flags & ts.SymbolFlags.Class) !== 0) return this.hasValidFieldType(symbol, relativeFile) ? "fieldType" : undefined;
        const isVariable = (symbol.flags & ts.SymbolFlags.Variable) !== 0;
        return isVariable && this.isEngineFieldAlias(this.checker.getTypeOfSymbol(symbol)) ? "fieldAlias" : undefined;
    }

    private isEngineFieldAlias(type: ts.Type): boolean {
        const symbol = type.aliasSymbol ?? type.symbol;
        return symbol !== undefined && symbol.name === ENGINE_FIELD_ALIAS_TYPE && this.isEngineSymbol(symbol);
    }

    private staticFieldTypeOf(symbol: ts.Symbol): ts.Symbol | undefined {
        return (symbol.flags & ts.SymbolFlags.Class) !== 0 ? symbol.exports?.get(STATIC_FIELD_TYPE_KEY as ts.__String) : undefined;
    }

    private hasValidFieldType(symbol: ts.Symbol, relativeFile: string): boolean {
        const member = this.staticFieldTypeOf(symbol);
        if (member === undefined) return false;
        const codec = this.checker.getTypeOfSymbol(member);
        if (FIELD_TYPE_CODEC_MEMBERS.every(name => codec.getProperty(name) !== undefined)) return true;
        this.warn(`${symbol.name}.${STATIC_FIELD_TYPE_KEY}: ${FIELD_TYPE_CODEC_WARNING} (${relativeFile})`);
        return false;
    }

    private staticCategoryOf(symbol: ts.Symbol, role: SchemaRole, className: string, relativeFile: string): string | undefined {
        const member = symbol.exports?.get(STATIC_CATEGORY_KEY as ts.__String);
        if (member === undefined) return undefined;
        if (role === "resource") {
            this.warn(`${className}.${STATIC_CATEGORY_KEY}: ${RESOURCE_CATEGORY_WARNING} (${relativeFile})`);
            return undefined;
        }
        const type = this.checker.getTypeOfSymbol(member);
        if (type.isStringLiteral() && type.value.length > 0) return type.value;
        this.warn(`${className}.${STATIC_CATEGORY_KEY}: ${CATEGORY_NOT_LITERAL_WARNING}; declare it as static readonly ${STATIC_CATEGORY_KEY} = "Name" (${relativeFile})`);
        return undefined;
    }

    private uniqueByName<T extends {readonly relativeFile: string}>(items: readonly T[], nameOf: (item: T) => string): T[] {
        const firstByName = new Map<string, T>();
        const unique: T[] = [];
        for (const item of items) {
            const name = nameOf(item);
            const first = firstByName.get(name);
            if (first !== undefined) {
                this.warn(`${name}: duplicate schema name in ${first.relativeFile} and ${item.relativeFile}; ${item.relativeFile} skipped`);
                continue;
            }
            firstByName.set(name, item);
            unique.push(item);
        }
        return unique;
    }

    private resolveAlias(symbol: ts.Symbol): ts.Symbol {
        return this.sources.resolveAlias(symbol);
    }

    private isEngineSymbol(symbol: ts.Symbol): boolean {
        return this.sources.isEngineSymbol(symbol);
    }

    private isLibrarySymbol(symbol: ts.Symbol): boolean {
        return (symbol.declarations ?? []).some(declaration => {
            const sourceFile = declaration.getSourceFile();
            return sourceFile.isDeclarationFile || this.program.isSourceFileDefaultLibrary(sourceFile) || this.program.isSourceFileFromExternalLibrary(sourceFile);
        });
    }

    private isProjectSymbol(symbol: ts.Symbol): boolean {
        if (this.isLibrarySymbol(symbol)) return false;
        return (symbol.declarations ?? []).some(declaration => isInside(this.sources.folder, declaration.getSourceFile().fileName));
    }

    private projectCustom(symbol: ts.Symbol | undefined): Mapped {
        return symbol !== undefined && this.isProjectSymbol(symbol) ? {kind: "custom", typeName: symbol.name} : UNSUPPORTED;
    }

    private isEngineClass(symbol: ts.Symbol, name: string): boolean {
        return this.sources.isEngineClass(symbol, name);
    }

    private isEngineRoot(symbol: ts.Symbol): boolean {
        return this.isEngineClass(symbol, ENGINE_COMPONENT_CLASS) || this.isEngineClass(symbol, ENGINE_RESOURCE_CLASS);
    }

    private classChain(symbol: ts.Symbol): ts.Symbol[] {
        return this.sources.classChain(symbol);
    }

    private schemaRoleOf(symbol: ts.Symbol): SchemaRole | undefined {
        for (const ancestor of this.classChain(symbol).slice(1)) {
            if (this.isEngineClass(ancestor, ENGINE_COMPONENT_CLASS)) return "component";
            if (this.isEngineClass(ancestor, ENGINE_RESOURCE_CLASS)) return "resource";
        }
        return undefined;
    }

    private schemaFields(schemaClass: SchemaClass): GeneratedField[] {
        const instanceType = this.checker.getDeclaredTypeOfSymbol(schemaClass.symbol);
        this.expanding.add(instanceType);
        try {
            return this.classFields(schemaClass.symbol, instanceType, schemaClass.className);
        } finally {
            this.expanding.delete(instanceType);
        }
    }

    private classFields(classSymbol: ts.Symbol, instanceType: ts.Type, path: string): GeneratedField[] {
        const declaringClasses = this.classChain(classSymbol).filter(symbol => !this.isEngineRoot(symbol)).reverse();
        const seen = new Set<string>();
        const fields: GeneratedField[] = [];
        for (const declaringClass of declaringClasses) {
            for (const member of declaringClass.members?.values() ?? []) {
                if (seen.has(member.name)) continue;
                seen.add(member.name);
                const field = this.memberField(this.checker.getPropertyOfType(instanceType, member.name) ?? member, path);
                if (field !== undefined) fields.push(field);
            }
        }
        return fields;
    }

    private objectFields(type: ts.Type, path: string): GeneratedField[] {
        const fields: GeneratedField[] = [];
        for (const property of this.checker.getPropertiesOfType(type)) {
            const field = this.memberField(property, path);
            if (field !== undefined) fields.push(field);
        }
        return fields;
    }

    private memberField(symbol: ts.Symbol, ownerPath: string): GeneratedField | undefined {
        if (!isDataMember(symbol)) return undefined;
        const type = this.checker.getTypeOfSymbol(symbol);
        const isOptional = (symbol.flags & ts.SymbolFlags.Optional) !== 0;
        const isFunction = this.checker.getSignaturesOfType(this.checker.getNonNullableType(type), ts.SignatureKind.Call).length > 0;
        if (isFunction) return undefined;
        if (isReadonlyMember(symbol)) return this.readonlyVectorField(symbol, type, isOptional);
        const path = `${ownerPath}.${symbol.name}`;
        const node = typeNodeOf(symbol);
        const mapped = isOptional ? asNullable(this.mapNode(node, this.checker.getNonNullableType(type), path)) : this.mapNode(node, type, path);
        if (mapped === SKIPPED) return undefined;
        if (mapped === UNSUPPORTED) {
            const typeText = node !== undefined ? node.getText() : this.checker.typeToString(type);
            this.warn(`${path}: ${UNSUPPORTED_TYPE_WARNING} ${typeText}`);
            return undefined;
        }
        return {key: symbol.name, ...mapped};
    }

    private readonlyVectorField(symbol: ts.Symbol, type: ts.Type, isOptional: boolean): GeneratedField | undefined {
        const vector = isOptional ? undefined : this.namedTypeOf(type);
        return vector !== undefined && VECTOR_KINDS.has(vector.kind) ? {key: symbol.name, ...vector} : undefined;
    }

    private mapNode(node: ts.TypeNode | undefined, type: ts.Type, path: string): Mapped {
        if (node === undefined) return this.mapType(type, path);
        if (ts.isParenthesizedTypeNode(node)) return this.mapNode(node.type, type, path);
        if (ts.isTypeOperatorNode(node) && node.operator === ts.SyntaxKind.ReadonlyKeyword) return this.mapNode(node.type, type, path);
        if (ts.isArrayTypeNode(node)) return this.mapList(node.elementType, type, path);
        if (ts.isUnionTypeNode(node)) return this.mapUnionNode(node, type, path);
        if (ts.isTypeReferenceNode(node)) return this.mapTypeReference(node, type, path);
        return this.mapType(type, path);
    }

    private mapUnionNode(node: ts.UnionTypeNode, type: ts.Type, path: string): Mapped {
        const present = node.types.filter(member => !isNullishTypeNode(member));
        const isNullable = present.length !== node.types.length;
        const literalValues = present.map(literalValueOfNode);
        const isLiteralUnion = present.length > 0 && literalValues.every(value => value !== undefined);
        if (isLiteralUnion) {
            const literalEnum: GeneratedType = {kind: "enum", members: literalMembers(literalValues as EnumValue[])};
            return isNullable ? asNullable(literalEnum) : literalEnum;
        }
        if (!isNullable || present.length !== 1) return this.mapType(type, path);
        return asNullable(this.mapNode(present[0], this.checker.getNonNullableType(type), path));
    }

    private mapList(elementNode: ts.TypeNode | undefined, type: ts.Type, path: string): Mapped {
        if (!this.checker.isArrayType(type)) return this.mapType(type, path);
        const elementType = this.checker.getTypeArguments(type as ts.TypeReference)[0];
        const element = this.mapNode(elementNode, elementType, `${path}${ARRAY_ELEMENT_SUFFIX}`);
        if (element === UNSUPPORTED || element === SKIPPED) return element;
        return {kind: "list", element};
    }

    private mapTypeReference(node: ts.TypeReferenceNode, type: ts.Type, path: string): Mapped {
        const referenced = this.checker.getSymbolAtLocation(node.typeName);
        if (referenced === undefined) return this.mapType(type, path);
        const symbol = this.resolveAlias(referenced);
        const named = this.engineNamedType(symbol);
        if (named !== undefined) return named;
        const isArrayReference = this.checker.isArrayType(type) && node.typeArguments?.length === 1;
        if (isArrayReference) return this.mapList(node.typeArguments![0], type, path);
        if ((symbol.flags & ts.SymbolFlags.TypeAlias) !== 0) return this.mapAlias(symbol, type, path);
        return this.mapType(type, path);
    }

    private mapAlias(symbol: ts.Symbol, type: ts.Type, path: string): Mapped {
        const declaration = symbol.declarations?.find(ts.isTypeAliasDeclaration);
        const isGeneric = declaration?.typeParameters !== undefined;
        const inner = declaration === undefined || isGeneric ? this.mapType(type, path) : this.mapNode(declaration.type, type, path);
        if (inner === UNSUPPORTED) return this.projectCustom(symbol);
        if (inner === SKIPPED) return inner;
        return withTypeName(this.withCompanionMemberNames(inner, symbol), symbol.name);
    }

    private withCompanionMemberNames(mapped: GeneratedType, symbol: ts.Symbol): GeneratedType {
        if (mapped.kind !== "enum") return mapped;
        const companion = symbol.valueDeclaration;
        if (companion === undefined || !ts.isVariableDeclaration(companion)) return mapped;
        const values = new Set(mapped.members.map(member => member.value));
        const named: EnumMember[] = [];
        for (const property of this.checker.getPropertiesOfType(this.checker.getTypeOfSymbol(symbol))) {
            const propertyType = this.checker.getTypeOfSymbol(property);
            const value = (propertyType.flags & LITERAL_TYPE_FLAGS) !== 0 ? (propertyType as ts.LiteralType).value as EnumValue : undefined;
            if (value !== undefined && values.delete(value)) named.push({name: property.name, value});
        }
        return values.size === 0 ? {...mapped, members: named} : mapped;
    }

    private engineNamedType(symbol: ts.Symbol): GeneratedType | undefined {
        const named = ENGINE_NAMED_TYPES.get(symbol.name);
        return named !== undefined && this.isEngineSymbol(symbol) ? named : undefined;
    }

    private namedTypeOf(type: ts.Type): GeneratedType | undefined {
        for (const symbol of [type.aliasSymbol, type.symbol]) {
            const named = symbol !== undefined ? this.engineNamedType(symbol) : undefined;
            if (named !== undefined) return named;
        }
        const alias = type.aliasSymbol;
        const length = type.aliasTypeArguments?.[0];
        const isEngineVec = alias !== undefined && alias.name === ENGINE_VEC_ALIAS && this.isEngineSymbol(alias);
        if (!isEngineVec || length === undefined || (length.flags & ts.TypeFlags.NumberLiteral) === 0) return undefined;
        return VEC_TYPES_BY_LENGTH.get((length as ts.NumberLiteralType).value);
    }

    private mapType(type: ts.Type, path: string): Mapped {
        if ((type.flags & UNMAPPABLE_TYPE_FLAGS) !== 0) return UNSUPPORTED;
        const named = this.namedTypeOf(type);
        if (named !== undefined) return named;
        if ((type.flags & (ts.TypeFlags.Boolean | ts.TypeFlags.BooleanLiteral)) !== 0) return {kind: "boolean"};
        const enumType = this.enumOf(type);
        if (enumType !== undefined) return enumType;
        if (type.isUnion()) return this.mapUnion(type, path);
        if ((type.flags & ts.TypeFlags.Number) !== 0) return {kind: "number"};
        if ((type.flags & ts.TypeFlags.String) !== 0) return {kind: "string", nullable: false};
        if ((type.flags & LITERAL_TYPE_FLAGS) !== 0) return this.literalEnum([type]) ?? UNSUPPORTED;
        if ((type.flags & (ts.TypeFlags.Object | ts.TypeFlags.Intersection)) !== 0) return this.mapObject(type, path);
        return UNSUPPORTED;
    }

    private enumOf(type: ts.Type): GeneratedType | undefined {
        const symbol = type.symbol;
        if (symbol === undefined || (symbol.flags & ts.SymbolFlags.Enum) === 0) return undefined;
        const members = type.isUnion() ? type.types : [type];
        const literal = this.literalEnum(members);
        return literal !== undefined && literal.kind === "enum" ? {...literal, typeName: symbol.name} : undefined;
    }

    private enumMemberName(type: ts.Type): string | undefined {
        const isEnumMember = type.symbol !== undefined && (type.symbol.flags & ts.SymbolFlags.EnumMember) !== 0;
        return isEnumMember ? type.symbol.name : undefined;
    }

    private literalEnum(types: readonly ts.Type[]): GeneratedType | undefined {
        const members: EnumMember[] = [];
        for (const type of types) {
            if ((type.flags & LITERAL_TYPE_FLAGS) === 0) return undefined;
            const value = (type as ts.LiteralType).value as EnumValue;
            members.push({name: this.enumMemberName(type) ?? String(value), value});
        }
        return members.length > 0 ? {kind: "enum", members} : undefined;
    }

    private mapUnion(type: ts.UnionType, path: string): Mapped {
        const present = type.types.filter(member => (member.flags & NULLISH_TYPE_FLAGS) === 0);
        const isNullable = present.length !== type.types.length;
        if (present.length === 0) return UNSUPPORTED;
        const isBoolean = present.every(member => (member.flags & ts.TypeFlags.BooleanLiteral) !== 0);
        let inner: Mapped;
        if (present.length === 1) inner = this.mapType(present[0], path);
        else if (isBoolean) inner = {kind: "boolean"};
        else inner = this.enumOf(this.checker.getNonNullableType(type)) ?? this.literalEnum(present) ?? UNSUPPORTED;
        return isNullable ? asNullable(inner) : inner;
    }

    private mapObject(type: ts.Type, path: string): Mapped {
        if (this.checker.isArrayType(type)) return this.mapList(undefined, type, path);
        const isCallable = this.checker.getSignaturesOfType(type, ts.SignatureKind.Call).length > 0;
        if (this.checker.isTupleType(type) || isCallable) return this.projectCustom(this.namedSymbolOf(type));
        const symbol = type.symbol;
        const isClass = symbol !== undefined && (symbol.flags & ts.SymbolFlags.Class) !== 0;
        if (isClass) return this.mapClass(type, symbol, path);
        if (symbol !== undefined && this.isLibrarySymbol(symbol)) return UNSUPPORTED;
        return this.mapStruct(type, this.namedSymbolOf(type), undefined, path);
    }

    private namedSymbolOf(type: ts.Type): ts.Symbol | undefined {
        if (type.aliasSymbol !== undefined) return type.aliasSymbol;
        const isNamedObject = type.symbol !== undefined && (type.symbol.flags & (ts.SymbolFlags.Class | ts.SymbolFlags.Interface)) !== 0;
        return isNamedObject ? type.symbol : undefined;
    }

    private isResourceClass(symbol: ts.Symbol): boolean {
        return this.classChain(symbol).some(ancestor => this.isEngineClass(ancestor, ENGINE_RESOURCE_CLASS));
    }

    private mapClass(type: ts.Type, symbol: ts.Symbol, path: string): Mapped {
        if (this.isResourceClass(symbol)) return {kind: "asset", assetType: symbol.name};
        if (this.isEngineSymbol(symbol) || this.isLibrarySymbol(symbol)) return UNSUPPORTED;
        if (this.staticFieldTypeOf(symbol) !== undefined) return this.fieldTypeClass(symbol);
        const create = this.creatableClass(symbol);
        if (create === undefined) return this.projectCustom(symbol);
        return this.mapStruct(type, symbol, {symbol, create}, path);
    }

    private fieldTypeClass(symbol: ts.Symbol): Mapped {
        const isUnexported = this.exportReferenceOf(symbol) === undefined;
        if (isUnexported && !this.unexportedFieldTypes.has(symbol)) {
            this.unexportedFieldTypes.add(symbol);
            this.warn(`${symbol.name}.${STATIC_FIELD_TYPE_KEY}: ${symbol.name} ${FIELD_TYPE_NOT_EXPORTED_WARNING}; export it by name`);
        }
        return this.projectCustom(symbol);
    }

    private creatableClass(symbol: ts.Symbol): ExportReference | undefined {
        const declaration = symbol.declarations?.find(ts.isClassDeclaration);
        if (declaration === undefined) return undefined;
        const isAbstract = (ts.getCombinedModifierFlags(declaration) & ts.ModifierFlags.Abstract) !== 0;
        if (isAbstract || !this.sources.constructsWithoutArguments(symbol)) return undefined;
        return this.exportReferenceOf(symbol);
    }

    private exportReferenceOf(symbol: ts.Symbol): ExportReference | undefined {
        const declaration = symbol.declarations?.find(ts.isClassDeclaration);
        if (declaration === undefined) return undefined;
        const sourceFile = declaration.getSourceFile();
        const moduleSymbol = this.checker.getSymbolAtLocation(sourceFile);
        if (moduleSymbol === undefined) return undefined;
        const exported = this.checker.getExportsOfModule(moduleSymbol).find(candidate => this.resolveAlias(candidate) === symbol);
        if (exported === undefined || exported.name === DEFAULT_EXPORT_NAME) return undefined;
        return {fileName: sourceFile.fileName, exportName: exported.name};
    }

    private mapStruct(type: ts.Type, named: ts.Symbol | undefined, classInfo: {symbol: ts.Symbol; create: ExportReference} | undefined, path: string): Mapped {
        const typeName = named?.name;
        if (this.expanding.has(type)) {
            this.warn(`${path}: ${RECURSIVE_TYPE_WARNING} ${typeName ?? this.checker.typeToString(type)} skipped`);
            return SKIPPED;
        }
        this.expanding.add(type);
        let fields: GeneratedField[];
        try {
            fields = classInfo !== undefined ? this.classFields(classInfo.symbol, type, path) : this.objectFields(type, path);
        } finally {
            this.expanding.delete(type);
        }
        if (fields.length === 0) return this.projectCustom(named);
        const struct: GeneratedType = {kind: "struct", fields};
        return {...struct, ...(typeName !== undefined ? {typeName} : {}), ...(classInfo !== undefined ? {create: classInfo.create} : {})};
    }

}

function collectAssetKinds(type: GeneratedType, kinds: Set<string>): void {
    if (type.kind === "asset") kinds.add(type.assetType);
    if (type.kind === "list") collectAssetKinds(type.element, kinds);
    if (type.kind === "struct") for (const field of type.fields) collectAssetKinds(field, kinds);
}

function summaryOf(schemas: readonly GeneratedSchema[]): ProjectSchemaSummary {
    const assetKinds = new Set<string>();
    for (const schema of schemas) for (const field of schema.fields) collectAssetKinds(field, assetKinds);
    return {
        typeNames: schemas.map(schema => schema.schemaClass.className),
        assetKinds: [...assetKinds],
        hasOwnSchemaClasses: schemas.some(schema => schema.schemaClass.hasOwnSchema),
    };
}

function sourceReference(sources: ProjectSources, source: SourceExport): ExportReference {
    return {fileName: sources.sourceModule(...source.path), exportName: source.name};
}

function importTableFor(sources: ProjectSources, file: string, exportName: string): ImportTable {
    return new ImportTable(reference => sources.importSpecifier(file, reference.fileName.replace(SOURCE_EXTENSION_PATTERN, "")), [SCHEMA_ENTRY_TYPE, exportName]);
}

function schemaListText(sources: ProjectSources, file: string, exportName: string, imports: ImportTable, entries: readonly string[]): string {
    const engineScene = sources.importSpecifier(file, sources.engineModule(ENGINE_SCENE_MODULE));
    const declaration = `export const ${exportName}: readonly ${SCHEMA_ENTRY_TYPE}[] = [`;
    const list = entries.length === 0 ? [`${declaration}];`] : [declaration, ...entries, "];"];
    const lines = [
        GENERATED_HEADER,
        `import type {${SCHEMA_ENTRY_TYPE}} from ${JSON.stringify(engineScene)};`,
        ...imports.importLines(),
        "",
        ...list,
    ];
    return lines.join(LINE_BREAK) + LINE_BREAK;
}

function catalogEntryLines(sources: ProjectSources, schemas: readonly CatalogSchema[], imports: ImportTable): string[] {
    const references = schemas.map(schema => sourceReference(sources, schema.source));
    for (const reference of references) imports.add(reference);
    return references.map(reference => `${INDENT}${imports.localName(reference)},`);
}

function renderProjectSchemas(sources: ProjectSources, analysis: ProjectSchemaAnalysis, engineSchemas: readonly CatalogSchema[]): string {
    const imports = importTableFor(sources, GENERATED_SCHEMAS_FILE, GENERATED_SCHEMAS_EXPORT);
    const engineEntries = catalogEntryLines(sources, engineSchemas, imports);
    for (const typing of analysis.typings) imports.add(typing.reference);
    for (const schema of analysis.schemas) imports.add(schema.schemaClass.reference);
    for (const schema of analysis.schemas) for (const field of schema.fields) collectClassReferences(field, imports);
    const entries = [
        ...engineEntries,
        ...analysis.typings.map(typing => renderFieldTyping(typing, imports)),
        ...analysis.schemas.map(schema => renderEntry(schema, imports)),
    ];
    return schemaListText(sources, GENERATED_SCHEMAS_FILE, GENERATED_SCHEMAS_EXPORT, imports, entries);
}

function renderOtherBackendTypes(names: readonly string[]): string[] {
    if (names.length === 0) return [];
    const list = `[${names.map(name => JSON.stringify(name)).join(", ")}]`;
    return [`${INDENT}${renderObject([["kind", JSON.stringify(OTHER_BACKEND_TYPES_KIND)], ["names", list]])},`];
}

function renderBackendSchemas(sources: ProjectSources, reachability: ProjectReachability, kind: RenderBackendKind): GeneratedSource {
    const file = generatedBackendSchemasFile(kind);
    const exportName = generatedBackendSchemasExport(kind);
    const imports = importTableFor(sources, file, exportName);
    const entries = [...catalogEntryLines(sources, reachability.hostSchemas(kind), imports), ...renderOtherBackendTypes(reachability.otherBackendTypeNames(kind))];
    return {file, source: schemaListText(sources, file, exportName, imports, entries)};
}

function collectClassReferences(type: GeneratedType, imports: ImportTable): void {
    if (type.kind === "list") collectClassReferences(type.element, imports);
    if (type.kind !== "struct") return;
    if (type.create !== undefined) imports.add(type.create);
    for (const field of type.fields) collectClassReferences(field, imports);
}

function renderEnumValue(value: EnumValue): string {
    return typeof value === "string" ? JSON.stringify(value) : String(value);
}

function renderFieldList(fields: readonly GeneratedField[], indent: string, imports: ImportTable): string {
    if (fields.length === 0) return "[]";
    const inner = indent + INDENT;
    const lines = fields.map(field => `${inner}${renderObject([["key", JSON.stringify(field.key)], ...typeEntries(field, inner, imports)])},`);
    return ["[", ...lines, `${indent}]`].join(LINE_BREAK);
}

function renderObject(entries: readonly (readonly [string, string])[]): string {
    return `{${entries.map(([name, value]) => `${name}: ${value}`).join(", ")}}`;
}

function typeEntries(type: GeneratedType, indent: string, imports: ImportTable): [string, string][] {
    const entries: [string, string][] = [["kind", JSON.stringify(type.kind)]];
    if ("nullable" in type && type.nullable !== undefined) entries.push(["nullable", String(type.nullable)]);
    if ("typeName" in type && type.typeName !== undefined) entries.push(["typeName", JSON.stringify(type.typeName)]);
    if (type.kind === "asset") entries.push(["assetType", JSON.stringify(type.assetType)]);
    if (type.kind === "enum") {
        const members = type.members.map(member => renderObject([["name", JSON.stringify(member.name)], ["value", renderEnumValue(member.value)]]));
        entries.push(["members", `[${members.join(", ")}]`]);
    }
    if (type.kind === "list") entries.push(["element", renderObject(typeEntries(type.element, indent, imports))]);
    if (type.kind === "struct") {
        if (type.create !== undefined) entries.push(["create", `() => new ${imports.localName(type.create)}()`]);
        entries.push(["fields", renderFieldList(type.fields, indent, imports)]);
    }
    return entries;
}

function renderFieldTyping(typing: FieldTyping, imports: ImportTable): string {
    const local = imports.localName(typing.reference);
    const value: [string, string] = typing.kind === "fieldAlias" ? ["alias", local] : ["definition", `${local}.${STATIC_FIELD_TYPE_KEY}`];
    return `${INDENT}${renderObject([["kind", JSON.stringify(typing.kind)], ["typeName", JSON.stringify(typing.typeName)], value])},`;
}

function classEntryKind(role: SchemaRole): string {
    return role === "component" ? "componentClass" : "resourceClass";
}

function renderEntry(schema: GeneratedSchema, imports: ImportTable): string {
    const {role, reference, className, category, hasOwnSchema} = schema.schemaClass;
    const ctor = imports.localName(reference);
    if (hasOwnSchema) return `${INDENT}${renderObject([["kind", JSON.stringify(classEntryKind(role))], ["ctor", ctor]])},`;
    const entries: [string, string][] = [
        ["kind", JSON.stringify(role)],
        ["ctor", ctor],
        ["name", JSON.stringify(className)],
        ["fields", renderFieldList(schema.fields, INDENT, imports)],
    ];
    if (category !== undefined) entries.push([STATIC_CATEGORY_KEY, JSON.stringify(category)]);
    return `${INDENT}${renderObject(entries)},`;
}

const analysesBySources = new WeakMap<ProjectSources, ProjectSchemaAnalysis>();

export function projectSchemaAnalysis(sources: ProjectSources): ProjectSchemaAnalysis {
    const known = analysesBySources.get(sources);
    if (known !== undefined) return known;
    const analysis = new SchemaGenerator(sources).analyze(sources.files, sources.manifest?.schemas?.exclude ?? NO_EXCLUDED_NAMES);
    analysesBySources.set(sources, analysis);
    return analysis;
}

export function projectReachabilityOf(sources: ProjectSources): ProjectReachability {
    return projectReachability(sources, projectSchemaAnalysis(sources).summary);
}

export function generateProjectSchemas(projectFolder: string, options: GenerateProjectSchemasOptions): GeneratedProjectSchemas {
    const sources = ProjectSources.read(projectFolder, options.repoRoot);
    const analysis = new SchemaGenerator(sources).analyze(sources.files, options.exclude ?? NO_EXCLUDED_NAMES);
    const reachability = projectReachability(sources, analysis.summary);
    return {source: renderProjectSchemas(sources, analysis, reachability.engineSchemas), warnings: [...analysis.warnings, ...reachability.warnings]};
}

export const SCHEMAS_GENERATOR: ProjectGenerator = {
    name: SCHEMAS_GENERATOR_NAME,
    version: SCHEMAS_GENERATOR_VERSION,
    files: [GENERATED_SCHEMAS_FILE, ...RENDER_BACKEND_KINDS.map(generatedBackendSchemasFile)],
    generate: sources => {
        const analysis = projectSchemaAnalysis(sources);
        const reachability = projectReachabilityOf(sources);
        return {
            sources: [
                {file: GENERATED_SCHEMAS_FILE, source: renderProjectSchemas(sources, analysis, reachability.engineSchemas)},
                ...RENDER_BACKEND_KINDS.map(kind => renderBackendSchemas(sources, reachability, kind)),
            ],
            warnings: [...analysis.warnings, ...reachability.warnings],
        };
    },
};
