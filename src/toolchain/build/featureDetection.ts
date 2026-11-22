import {existsSync} from "fs";
import {basename, dirname, extname, join} from "path";
import * as ts from "typescript";
import {optionalFeature, PLATFORM_FEATURE_CONSTANTS, PLATFORM_FEATURES} from "../../engine/platform/platform";
import type {PlatformFeature} from "../../engine/platform/platform";
import {CliError} from "../cliArguments";
import {isInside, projectCompilerOptions} from "../generate/projectSources";
import {REPO_ROOT, repoRelative, slashed, SOURCE_ROOT} from "../repoPaths";
import {featureConstantValues, TARGET_FEATURES} from "../targets";
import type {RunTarget} from "../targets";
import type {BundleInputs} from "./bundleMetafile";

export interface FeatureCheckBundle extends BundleInputs {
    readonly name: string;
    readonly target: RunTarget;
}

export interface MissingFeatures {
    readonly anyOf: readonly PlatformFeature[];
    readonly allOf: readonly PlatformFeature[];
}

export interface FeatureProblem {
    readonly symbol: string;
    readonly file: string;
    readonly line: number;
    readonly column: number;
    readonly missing: MissingFeatures;
    readonly chain: readonly string[];
}

export interface BundleFeatureResult {
    readonly bundle: string;
    readonly target: RunTarget;
    readonly modules: number;
    readonly problems: readonly FeatureProblem[];
}

export interface TargetFeatureReport {
    readonly ok: boolean;
    readonly target: RunTarget;
    readonly bundles: readonly BundleFeatureResult[];
    readonly errors: readonly string[];
}

type FeatureNeed = MissingFeatures;

interface FoldGuard {
    readonly condition: ts.Expression;
    readonly holds: boolean;
}

interface VisitContext {
    readonly guards: readonly FoldGuard[];
    readonly exempt: readonly PlatformFeature[];
}

interface FeatureUse {
    readonly symbol: string;
    readonly need: FeatureNeed;
    readonly line: number;
    readonly column: number;
    readonly context: VisitContext;
}

interface UseSink {
    readonly source: ts.SourceFile;
    readonly uses: FeatureUse[];
}

interface DeclarationFeatures {
    readonly features: readonly (PlatformFeature | undefined)[];
    readonly allInLibraries: boolean;
}

interface TargetFolding {
    readonly values: ReadonlyMap<string, boolean>;
    readonly folded: Map<ts.Expression, boolean | undefined>;
}

export const FEATURE_PROBLEM_FIX = "guard the code with the matching JSENGINE_HAS_* constant, move a runtime check into optionalFeature(), or stop importing the module";

const NO_NEED: FeatureNeed = {anyOf: [], allOf: []};
const ROOT_CONTEXT: VisitContext = {guards: [], exempt: []};
const DOM_LIBRARY_FEATURE: PlatformFeature = "dom";
const NAME_RULES: ReadonlyMap<string, PlatformFeature> = new Map<string, PlatformFeature>([
    ["Worker", "workers"],
    ["SharedArrayBuffer", "sharedMemory"],
    ["Atomics", "sharedMemory"],
    ["AudioContext", "audio"],
]);
const PACKAGE_FEATURES: readonly (readonly [folder: string, feature: PlatformFeature])[] = [
    ["/node_modules/@types/node/", "node"],
    ["/node_modules/bun-types/", "bun"],
    ["/node_modules/@types/bun/", "bun"],
    ["/node_modules/@webgpu/types/", "gpu"],
];
const DOM_LIBRARY_FILE = /^lib\.(dom|webworker)\b.*\.d\.ts$/;
const NODE_MODULES_SEGMENT = "/node_modules/";
const NODE_SPECIFIER_PREFIX = "node:";
const BUN_SPECIFIER = /^bun(:|$)/;
const REQUIRE_FUNCTION = "require";
const BOOLEAN_TYPEOF = "boolean";
const ANALYZED_EXTENSIONS: ReadonlySet<string> = new Set([".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"]);
const DECLARATION_FILE = /\.d\.[cm]?ts$/;
const FEATURE_CONSTANTS_DECLARATION = join(SOURCE_ROOT, "engine", "platform", "features.d.ts");
const OPTIONAL_FEATURE_SOURCE = join(SOURCE_ROOT, "engine", "platform", "platform.ts");
const WEBGPU_TYPES_DECLARATION = join(REPO_ROOT, "node_modules", "@webgpu", "types", "dist", "index.d.ts");
const TYPE_ROOTS: readonly string[] = [join(REPO_ROOT, "node_modules", "@types")];
const AMBIENT_TYPE_PACKAGES: readonly string[] = ["node", "bun"];
const FEATURE_CONSTANT_NAMES: ReadonlySet<string> = new Set(Object.values(PLATFORM_FEATURE_CONSTANTS));
const EQUALITY_OPERATORS: ReadonlySet<ts.SyntaxKind> = new Set([ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.EqualsEqualsToken]);
const INEQUALITY_OPERATORS: ReadonlySet<ts.SyntaxKind> = new Set([ts.SyntaxKind.ExclamationEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsToken]);
const CHAIN_SEPARATOR = " -> ";
const MAX_PROBLEMS_SHOWN_PER_BUNDLE = 10;
const CASE_INSENSITIVE_PATHS = process.platform === "win32";

function pathKey(path: string): string {
    const posix = slashed(path);
    return CASE_INSENSITIVE_PATHS ? posix.toLowerCase() : posix;
}

function isAnalyzedModule(path: string): boolean {
    const key = pathKey(path);
    return ANALYZED_EXTENSIONS.has(extname(key)) && !DECLARATION_FILE.test(key) && !key.includes(NODE_MODULES_SEGMENT) && existsSync(path);
}

function displayPath(path: string): string {
    return isInside(REPO_ROOT, path) ? repoRelative(path) : slashed(path);
}

function featureOrder(a: PlatformFeature, b: PlatformFeature): number {
    return PLATFORM_FEATURES.indexOf(a) - PLATFORM_FEATURES.indexOf(b);
}

function anyOfFeatures(features: readonly (PlatformFeature | undefined)[]): PlatformFeature[] {
    if (features.length === 0 || features.includes(undefined)) return [];
    return [...new Set(features as readonly PlatformFeature[])].sort(featureOrder);
}

function hasNeed(need: FeatureNeed): boolean {
    return need.anyOf.length > 0 || need.allOf.length > 0;
}

function missingFeatures(need: FeatureNeed, available: ReadonlySet<PlatformFeature>): MissingFeatures | undefined {
    const anyOf = need.anyOf.some(feature => available.has(feature)) ? [] : need.anyOf;
    const allOf = need.allOf.filter(feature => !available.has(feature));
    return hasNeed({anyOf, allOf}) ? {anyOf, allOf} : undefined;
}

function isTypeOnly(node: ts.Node): boolean {
    if (ts.isTypeNode(node)) return !ts.isExpressionWithTypeArguments(node);
    if (ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node) || ts.isTypeParameterDeclaration(node)) return true;
    return ts.canHaveModifiers(node) && (ts.getModifiers(node)?.some(modifier => modifier.kind === ts.SyntaxKind.DeclareKeyword) ?? false);
}

function isShortCircuit(operator: ts.SyntaxKind): boolean {
    return operator === ts.SyntaxKind.AmpersandAmpersandToken || operator === ts.SyntaxKind.BarBarToken;
}

function mentionsFeatureConstant(node: ts.Node): boolean {
    if (ts.isIdentifier(node)) return FEATURE_CONSTANT_NAMES.has(node.text);
    return ts.forEachChild(node, mentionsFeatureConstant) === true;
}

function guarded(context: VisitContext, condition: ts.Expression, holds: boolean): VisitContext {
    if (!mentionsFeatureConstant(condition)) return context;
    return {...context, guards: [...context.guards, {condition, holds}]};
}

function exempted(context: VisitContext, feature: PlatformFeature): VisitContext {
    return {...context, exempt: [...context.exempt, feature]};
}

function foldedTypeofComparison(comparison: ts.BinaryExpression, values: ReadonlyMap<string, boolean>): boolean | undefined {
    const operator = comparison.operatorToken.kind;
    const negated = INEQUALITY_OPERATORS.has(operator);
    if (!negated && !EQUALITY_OPERATORS.has(operator)) return undefined;
    const [typeOf, literal] = ts.isTypeOfExpression(comparison.left) ? [comparison.left, comparison.right] : [comparison.right, comparison.left];
    if (!ts.isTypeOfExpression(typeOf) || !ts.isIdentifier(typeOf.expression) || !ts.isStringLiteralLike(literal)) return undefined;
    if (!values.has(typeOf.expression.text)) return undefined;
    const equal = literal.text === BOOLEAN_TYPEOF;
    return negated ? !equal : equal;
}

function foldedValue(expression: ts.Expression, values: ReadonlyMap<string, boolean>): boolean | undefined {
    if (ts.isParenthesizedExpression(expression)) return foldedValue(expression.expression, values);
    if (ts.isIdentifier(expression)) return values.get(expression.text);
    if (expression.kind === ts.SyntaxKind.TrueKeyword) return true;
    if (expression.kind === ts.SyntaxKind.FalseKeyword) return false;
    if (ts.isPrefixUnaryExpression(expression) && expression.operator === ts.SyntaxKind.ExclamationToken) {
        const operand = foldedValue(expression.operand, values);
        return operand === undefined ? undefined : !operand;
    }
    if (ts.isConditionalExpression(expression)) {
        const condition = foldedValue(expression.condition, values);
        if (condition === undefined) return undefined;
        return foldedValue(condition ? expression.whenTrue : expression.whenFalse, values);
    }
    if (!ts.isBinaryExpression(expression)) return undefined;
    const operator = expression.operatorToken.kind;
    if (operator === ts.SyntaxKind.AmpersandAmpersandToken) {
        const left = foldedValue(expression.left, values);
        return left === true ? foldedValue(expression.right, values) : left;
    }
    if (operator === ts.SyntaxKind.BarBarToken) {
        const left = foldedValue(expression.left, values);
        return left === false ? foldedValue(expression.right, values) : left;
    }
    return foldedTypeofComparison(expression, values);
}

function importChains(bundle: BundleInputs): Map<string, readonly string[]> {
    const importsByKey = new Map([...bundle.imports].map(([importer, imported]) => [pathKey(importer), imported]));
    const chains = new Map<string, readonly string[]>([[pathKey(bundle.entry), [bundle.entry]]]);
    const queue: string[] = [bundle.entry];
    for (let index = 0; index < queue.length; index++) {
        const importer = queue[index];
        const chain = chains.get(pathKey(importer)) ?? [importer];
        for (const imported of importsByKey.get(pathKey(importer)) ?? []) {
            if (chains.has(pathKey(imported))) continue;
            chains.set(pathKey(imported), [...chain, imported]);
            queue.push(imported);
        }
    }
    return chains;
}

function compareProblems(a: FeatureProblem, b: FeatureProblem): number {
    if (a.chain.length !== b.chain.length) return a.chain.length - b.chain.length;
    if (a.file !== b.file) return a.file < b.file ? -1 : 1;
    return a.line - b.line || a.column - b.column;
}

class FeatureDetector {
    private readonly program: ts.Program;
    private readonly checker: ts.TypeChecker;
    private readonly libraryFolder: string;
    private readonly usesByModule = new Map<string, readonly FeatureUse[]>();
    private readonly declarationFeaturesBySymbol = new Map<ts.Symbol, DeclarationFeatures>();
    private readonly memberNeedBySymbol = new Map<ts.Symbol, FeatureNeed>();
    private readonly foldingByTarget = new Map<RunTarget, TargetFolding>();

    public constructor(modules: readonly string[]) {
        const options: ts.CompilerOptions = {...projectCompilerOptions(REPO_ROOT), allowJs: true, types: [...AMBIENT_TYPE_PACKAGES], typeRoots: [...TYPE_ROOTS]};
        const rootNames = [...new Set(modules.filter(isAnalyzedModule)), FEATURE_CONSTANTS_DECLARATION, WEBGPU_TYPES_DECLARATION];
        this.program = ts.createProgram({rootNames, options});
        this.checker = this.program.getTypeChecker();
        this.libraryFolder = pathKey(dirname(ts.getDefaultLibFilePath(options)));
    }

    public check(bundle: FeatureCheckBundle): BundleFeatureResult {
        const available: ReadonlySet<PlatformFeature> = new Set(TARGET_FEATURES[bundle.target]);
        const chains = importChains(bundle);
        const modules = [...new Set(bundle.modules)].filter(isAnalyzedModule);
        const problems: FeatureProblem[] = [];
        for (const module of modules) {
            const chain = (chains.get(pathKey(module)) ?? [module]).map(displayPath);
            const reportedSymbols = new Set<string>();
            const reportedLines = new Set<string>();
            for (const use of this.usesOf(module)) {
                if (!this.isLive(use.context.guards, bundle.target)) continue;
                const exempt = use.context.exempt;
                const missing = missingFeatures(use.need, exempt.length === 0 ? available : new Set([...available, ...exempt]));
                if (missing === undefined) continue;
                const lacking = missingFeaturesText(missing);
                const symbolKey = `${use.symbol} ${lacking}`;
                const lineKey = `${use.line} ${lacking}`;
                if (reportedSymbols.has(symbolKey) || reportedLines.has(lineKey)) continue;
                reportedSymbols.add(symbolKey);
                reportedLines.add(lineKey);
                problems.push({symbol: use.symbol, file: displayPath(module), line: use.line, column: use.column, missing, chain});
            }
        }
        return {bundle: bundle.name, target: bundle.target, modules: modules.length, problems: problems.sort(compareProblems)};
    }

    private isLive(guards: readonly FoldGuard[], target: RunTarget): boolean {
        if (guards.length === 0) return true;
        const folding = this.foldingFor(target);
        return guards.every(guard => {
            if (!folding.folded.has(guard.condition)) folding.folded.set(guard.condition, foldedValue(guard.condition, folding.values));
            const value = folding.folded.get(guard.condition);
            return value === undefined || value === guard.holds;
        });
    }

    private foldingFor(target: RunTarget): TargetFolding {
        const existing = this.foldingByTarget.get(target);
        if (existing !== undefined) return existing;
        const folding: TargetFolding = {values: featureConstantValues(target), folded: new Map()};
        this.foldingByTarget.set(target, folding);
        return folding;
    }

    private usesOf(module: string): readonly FeatureUse[] {
        const key = pathKey(module);
        const cached = this.usesByModule.get(key);
        if (cached !== undefined) return cached;
        const source = this.program.getSourceFile(module);
        const uses: FeatureUse[] = [];
        if (source !== undefined) this.visit(source, ROOT_CONTEXT, {source, uses});
        this.usesByModule.set(key, uses);
        return uses;
    }

    private visit(node: ts.Node, context: VisitContext, sink: UseSink): void {
        if (isTypeOnly(node)) return;
        if (ts.isHeritageClause(node)) {
            if (node.token === ts.SyntaxKind.ExtendsKeyword && ts.isClassLike(node.parent)) {
                for (const type of node.types) this.visit(type.expression, context, sink);
            }
            return;
        }
        if (ts.isImportDeclaration(node)) {
            if (node.importClause === undefined) this.recordModule(node.moduleSpecifier, context, sink);
            return;
        }
        if (ts.isExportDeclaration(node) || ts.isImportEqualsDeclaration(node)) return;
        if (ts.isIfStatement(node)) {
            this.visit(node.expression, context, sink);
            this.visit(node.thenStatement, guarded(context, node.expression, true), sink);
            if (node.elseStatement !== undefined) this.visit(node.elseStatement, guarded(context, node.expression, false), sink);
            return;
        }
        if (ts.isConditionalExpression(node)) {
            this.visit(node.condition, context, sink);
            this.visit(node.whenTrue, guarded(context, node.condition, true), sink);
            this.visit(node.whenFalse, guarded(context, node.condition, false), sink);
            return;
        }
        if (ts.isBinaryExpression(node) && isShortCircuit(node.operatorToken.kind)) {
            this.visit(node.left, context, sink);
            this.visit(node.right, guarded(context, node.left, node.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken), sink);
            return;
        }
        if (ts.isTypeOfExpression(node) && ts.isIdentifier(node.expression)) return;
        if (ts.isCallExpression(node) && this.visitedSpecialCall(node, context, sink)) return;
        if (ts.isShorthandPropertyAssignment(node)) {
            this.recordGlobal(node.name, this.checker.getShorthandAssignmentValueSymbol(node), context, sink);
            if (node.objectAssignmentInitializer !== undefined) this.visit(node.objectAssignmentInitializer, context, sink);
            return;
        }
        if (ts.isPropertyAccessExpression(node)) {
            this.visit(node.expression, context, sink);
            if (ts.isIdentifier(node.name)) this.recordMember(node.name, context, sink);
            return;
        }
        if (ts.isElementAccessExpression(node) && ts.isStringLiteralLike(node.argumentExpression)) {
            this.visit(node.expression, context, sink);
            this.recordMember(node.argumentExpression, context, sink);
            return;
        }
        if (ts.isIdentifier(node)) {
            this.recordGlobal(node, this.checker.getSymbolAtLocation(node), context, sink);
            return;
        }
        ts.forEachChild(node, child => this.visit(child, context, sink));
    }

    private visitedSpecialCall(call: ts.CallExpression, context: VisitContext, sink: UseSink): boolean {
        const [first, probe, ...rest] = call.arguments;
        const dynamicImport = call.expression.kind === ts.SyntaxKind.ImportKeyword;
        const requireCall = ts.isIdentifier(call.expression) && call.expression.text === REQUIRE_FUNCTION;
        if ((dynamicImport || requireCall) && first !== undefined) {
            if (requireCall) this.visit(call.expression, context, sink);
            this.recordModule(first, context, sink);
            for (const argument of call.arguments.slice(1)) this.visit(argument, context, sink);
            return true;
        }
        const feature = this.optionalFeatureOf(call);
        if (feature === undefined) return false;
        this.visit(call.expression, context, sink);
        if (probe !== undefined) this.visit(probe, exempted(context, feature), sink);
        for (const argument of rest) this.visit(argument, context, sink);
        return true;
    }

    private optionalFeatureOf(call: ts.CallExpression): PlatformFeature | undefined {
        const callee = ts.isPropertyAccessExpression(call.expression) ? call.expression.name : call.expression;
        if (!ts.isIdentifier(callee) || callee.text !== optionalFeature.name) return undefined;
        const [named] = call.arguments;
        if (named === undefined || !ts.isStringLiteralLike(named)) return undefined;
        const feature = PLATFORM_FEATURES.find(each => each === named.text);
        const declarations = this.resolvedSymbol(this.checker.getSymbolAtLocation(callee))?.declarations ?? [];
        const isEngineFunction = declarations.some(declaration => pathKey(declaration.getSourceFile().fileName) === pathKey(OPTIONAL_FEATURE_SOURCE));
        return isEngineFunction ? feature : undefined;
    }

    private resolvedSymbol(symbol: ts.Symbol | undefined): ts.Symbol | undefined {
        if (symbol === undefined || (symbol.flags & ts.SymbolFlags.Alias) === 0) return symbol;
        return this.checker.getAliasedSymbol(symbol);
    }

    private recordModule(specifier: ts.Expression, context: VisitContext, sink: UseSink): void {
        if (!ts.isStringLiteralLike(specifier)) return;
        this.record(JSON.stringify(specifier.text), this.moduleNeedOf(specifier), specifier, context, sink);
    }

    private moduleNeedOf(specifier: ts.StringLiteralLike): FeatureNeed {
        if (specifier.text.startsWith(NODE_SPECIFIER_PREFIX)) return {anyOf: ["node"], allOf: []};
        if (BUN_SPECIFIER.test(specifier.text)) return {anyOf: ["bun"], allOf: []};
        const module = this.checker.getSymbolAtLocation(specifier);
        return module === undefined ? NO_NEED : {anyOf: anyOfFeatures(this.declarationFeatures(module).features), allOf: []};
    }

    private recordGlobal(node: ts.Identifier, found: ts.Symbol | undefined, context: VisitContext, sink: UseSink): void {
        if (found === undefined) return;
        const aliased = (found.flags & ts.SymbolFlags.Alias) !== 0;
        const symbol = this.resolvedSymbol(found) ?? found;
        const declarations = this.declarationFeatures(symbol);
        const nameFeature = !aliased && declarations.allInLibraries ? NAME_RULES.get(node.text) : undefined;
        const need: FeatureNeed = {anyOf: anyOfFeatures(declarations.features), allOf: nameFeature === undefined ? [] : [nameFeature]};
        this.record(node.text, need, node, context, sink);
    }

    private recordMember(name: ts.Identifier | ts.StringLiteralLike, context: VisitContext, sink: UseSink): void {
        const member = this.checker.getSymbolAtLocation(name);
        if (member === undefined) return;
        this.record(name.text, this.memberNeedOf(member), name, context, sink);
    }

    private memberNeedOf(member: ts.Symbol): FeatureNeed {
        const cached = this.memberNeedBySymbol.get(member);
        if (cached !== undefined) return cached;
        const features = [...this.declarationFeatures(member).features, ...this.ownerFeatures(member)];
        const need = features.includes(DOM_LIBRARY_FEATURE) ? NO_NEED : {anyOf: anyOfFeatures(features), allOf: []};
        this.memberNeedBySymbol.set(member, need);
        return need;
    }

    private ownerFeatures(member: ts.Symbol): (PlatformFeature | undefined)[] {
        return (member.declarations ?? []).flatMap(declaration => {
            const owner = declaration.parent;
            const named = (ts.isInterfaceDeclaration(owner) || ts.isClassDeclaration(owner)) ? owner.name : undefined;
            const ownerSymbol = named === undefined ? undefined : this.checker.getSymbolAtLocation(named);
            return ownerSymbol === undefined ? [] : [...this.declarationFeatures(ownerSymbol).features];
        });
    }

    private declarationFeatures(symbol: ts.Symbol): DeclarationFeatures {
        const cached = this.declarationFeaturesBySymbol.get(symbol);
        if (cached !== undefined) return cached;
        const files = (symbol.declarations ?? []).map(declaration => pathKey(declaration.getSourceFile().fileName));
        const features: DeclarationFeatures = {
            features: files.map(file => this.fileFeature(file)),
            allInLibraries: files.length > 0 && files.every(file => this.isLibraryFile(file)),
        };
        this.declarationFeaturesBySymbol.set(symbol, features);
        return features;
    }

    private fileFeature(file: string): PlatformFeature | undefined {
        if (file.startsWith(this.libraryFolder)) return DOM_LIBRARY_FILE.test(basename(file)) ? DOM_LIBRARY_FEATURE : undefined;
        return PACKAGE_FEATURES.find(([folder]) => file.includes(folder))?.[1];
    }

    private isLibraryFile(file: string): boolean {
        return file.startsWith(this.libraryFolder) || file.includes(NODE_MODULES_SEGMENT);
    }

    private record(symbol: string, need: FeatureNeed, node: ts.Node, context: VisitContext, sink: UseSink): void {
        if (!hasNeed(need)) return;
        const {line, character} = sink.source.getLineAndCharacterOfPosition(node.getStart(sink.source));
        sink.uses.push({symbol, need, line: line + 1, column: character + 1, context});
    }
}

export function checkBundleFeatures(bundles: readonly FeatureCheckBundle[]): BundleFeatureResult[] {
    if (bundles.length === 0) return [];
    const detector = new FeatureDetector(bundles.flatMap(bundle => bundle.modules));
    return bundles.map(bundle => detector.check(bundle));
}

export function targetFeatureReport(target: RunTarget, bundles: readonly BundleFeatureResult[], errors: readonly string[] = []): TargetFeatureReport {
    return {ok: errors.length === 0 && bundles.every(bundle => bundle.problems.length === 0), target, bundles, errors};
}

export function missingFeaturesText(missing: MissingFeatures): string {
    const alternatives = missing.anyOf.length === 0 ? [] : [missing.anyOf.length === 1 ? missing.anyOf[0] : `one of ${missing.anyOf.join(", ")}`];
    return [...missing.allOf, ...alternatives].join(" and ");
}

export function featureProblemLine(target: RunTarget, problem: FeatureProblem): string {
    const importers = problem.chain.slice(0, -1);
    const via = importers.length === 0 ? "" : `, via ${importers.join(CHAIN_SEPARATOR)}`;
    return `${target} lacks ${missingFeaturesText(problem.missing)}: ${problem.file}:${problem.line} uses ${problem.symbol}${via}`;
}

export function featureProblemLines(results: readonly BundleFeatureResult[]): string[] {
    return results.flatMap(result => {
        const shown = result.problems.slice(0, MAX_PROBLEMS_SHOWN_PER_BUNDLE).map(problem => featureProblemLine(result.target, problem));
        const hidden = result.problems.length - shown.length;
        return hidden > 0 ? [...shown, `${hidden} more in ${result.bundle}`] : shown;
    });
}

export function featureProblemCount(results: readonly BundleFeatureResult[]): number {
    return results.reduce((sum, result) => sum + result.problems.length, 0);
}

export function requireTargetFeatures(report: TargetFeatureReport): void {
    if (report.errors.length > 0) throw new CliError(`the ${report.target} build failed:`, report.errors);
    const problems = featureProblemCount(report.bundles);
    if (problems === 0) return;
    throw new CliError(`the ${report.target} build has ${problems} use(s) of features the ${report.target} lacks; ${FEATURE_PROBLEM_FIX}:`, featureProblemLines(report.bundles));
}

export function featureSummary(report: TargetFeatureReport): string {
    const modules = report.bundles.reduce((sum, bundle) => sum + bundle.modules, 0);
    return `features OK: ${report.bundles.length} ${report.target} bundle(s), ${modules} modules, use only what the ${report.target} provides (${TARGET_FEATURES[report.target].join(", ")})`;
}
