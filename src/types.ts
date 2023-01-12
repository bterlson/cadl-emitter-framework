import {
  Program,
  Type,
  Model,
  ModelProperty,
  Operation,
  Union,
  Enum,
  Interface,
  Tuple,
} from "@cadl-lang/compiler";
import { TypeEmitter } from "./type-emitter.js";
import { Placeholder } from "./placeholder.js";

export interface EmitContext {
  program: Program;
  AssetTag: AssetTag;
  createAssetEmitter<T>(
    TypeEmitterClass: typeof TypeEmitter<T>,
    ...tags: AssetTagInstance[]
  ): AssetEmitter<T>;
}

export interface AssetEmitter<T> {
  getContext(): Context;
  getProgram(): Program;
  emitTypeReference(type: Type): EmitEntity<T>;
  emitDeclarationName(type: CadlDeclaration): string;
  emitType(type: Type): EmitEntity<T>;
  emitProgram(options?: {
    emitGlobalNamespace?: boolean;
    emitCadlNamespace?: boolean;
  }): void;
  emitModelProperties(model: Model): EmitEntity<T>;
  emitModelProperty(prop: ModelProperty): EmitEntity<T>;
  emitOperationParameters(operation: Operation): EmitEntity<T>;
  emitOperationReturnType(operation: Operation): EmitEntity<T>;
  emitInterfaceOperations(iface: Interface): EmitEntity<T>;
  emitInterfaceOperation(operation: Operation): EmitEntity<T>;
  emitEnumMembers(en: Enum): EmitEntity<T>;
  emitUnionVariants(union: Union): EmitEntity<T>;
  emitTupleLiteralValues(tuple: Tuple): EmitEntity<T>;
  createSourceFile(name: string): SourceFile<T>;
  createScope(sourceFile: SourceFile<T>, name: string): SourceFileScope<T>;
  createScope(
    namespace: any,
    name: string,
    parentScope: Scope<T>
  ): NamespaceScope<T>;
  createScope(
    block: any,
    name: string,
    parentScope?: Scope<T> | null
  ): Scope<T>;
  result: {
    declaration(
      name: string,
      value: T | Placeholder<T>
    ): Declaration<T>;
    rawCode(value: T | Placeholder<T>): RawCode<T>;
    none(): NoEmit;
  };
  writeOutput(): Promise<void>;
}

export interface ScopeBase<T> {
  kind: string;
  name: string;
  parentScope: Scope<T> | null;
  childScopes: Scope<T>[];
  declarations: Declaration<T>[];
}

export interface SourceFileScope<T> extends ScopeBase<T> {
  kind: "sourceFile";
  sourceFile: SourceFile<T>;
}

export interface NamespaceScope<T> extends ScopeBase<T> {
  kind: "namespace";
  namespace: any;
}

export type Scope<T> = SourceFileScope<T> | NamespaceScope<T>;

export interface TypeReference {
  expression: string;
}

export interface SourceFile<T> {
  path: string;
  globalScope: Scope<T>;
  imports: Map<string, string[]>;
}

export interface EmittedSourceFile {
  contents: string;
  path: string;
}

export type EmitEntity<T> = Declaration<T> | RawCode<T> | NoEmit | CircularEmit;

export class EmitterResult {}
export class Declaration<T> extends EmitterResult {
  public kind = "declaration" as const;

  constructor(public name: string, public scope: Scope<T>, public value: T | Placeholder<T>) {
    if (value instanceof Placeholder) {
      value.onValue(v => this.value = v);
    }
    
    super();
  }
}

export class RawCode<T> extends EmitterResult {
  public kind = "code" as const;

  constructor(public value: T | Placeholder<T>) {
    if (value instanceof Placeholder) {
      value.onValue(v => this.value = v);
    }

    super();
  }
}

export class NoEmit extends EmitterResult {
  public kind = "none" as const;
}

export class CircularEmit extends EmitterResult {
  public kind = "circular" as const;
  constructor(public emitEntityKey: [string, Type, ContextState]) {
    super();
  }
}

export interface AssetTag {
  language: AssetTagFactory;
  create(key: string): AssetTagFactory;
}

export interface AssetTagInstance {}

export type AssetTagFactory = {
  (value: string): AssetTagInstance;
};

export type CadlDeclaration = Model | Interface | Union | Operation | Enum;

export interface ContextState {
  lexicalContext: Record<string, any>;
  referenceContext: Record<string, any>;
}

export type Context = Record<string, any>;
export type ESRecord = Record<string, any> & { _record: true };

export interface EmitterState {
  lexicalTypeStack: Type[];
  context: ContextState;
}
