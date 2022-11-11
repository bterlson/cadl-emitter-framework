import {
  Type,
  Program,
  Model,
  getIntrinsicModelName,
  Interface,
  Union,
  Operation,
  Enum,
  ModelProperty,
  Namespace,
  namespace,
  BooleanLiteral
} from "@cadl-lang/compiler";

type EndingWith<Names, Name extends string> = Names extends `${infer _X}${Name}`
  ? Names
  : never;

export interface EmitContext {
  program: Program;
  AssetTag: AssetTag;
  createAssetEmitter(
    TypeEmitterClass: typeof TypeEmitter,
    ...tags: AssetTagInstance[]
  ): AssetEmitter;
}

export interface AssetEmitter {
  getContext(): Context;
  getReferenceContext(): Context;
  getProgram(): Program;
  emitTypeReference(type: Type): EmitEntity;
  emitDeclarationName(type: CadlDeclaration): string;
  emitType(type: Type): EmitEntity;
  emitProgram(options?: {
    emitGlobalNamespace?: boolean;
    emitCadlNamespace?: boolean;
  }): void;
  emitModelProperties(model: Model): EmitEntity;
  emitModelProperty(prop: ModelProperty): EmitEntity;
  createSourceFile(name: string): SourceFile;
  createScope(sourceFile: SourceFile, name: string): SourceFileScope;
  createScope(namespace: any, name: string, parentScope: Scope): NamespaceScope;
  createScope(block: any, name: string, parentScope?: Scope | null): Scope;
  result: {
    declaration(name: string, code: string | CodeBuilder): Declaration;
    literal(code: string | CodeBuilder): Literal;
    rawCode(code: string | CodeBuilder): RawCode;
    none(): NoEmit;
  };
  writeOutput(): Promise<void>;
}

export interface ScopeBase {
  kind: string;
  name: string;
  parentScope: Scope | null;
  childScopes: Scope[];
  declarations: Declaration[];
}

export interface SourceFileScope extends ScopeBase {
  kind: "sourceFile";
  sourceFile: SourceFile;
}

export interface NamespaceScope extends ScopeBase {
  kind: "namespace";
  namespace: any;
}

export type Scope = SourceFileScope | NamespaceScope;

export interface TypeReference {
  expression: string;
}

export interface SourceFile {
  path: string;
  globalScope: Scope;
  imports: Map<string, string[]>;
}

export interface EmittedSourceFile {
  contents: string;
  path: string;
}

export type EmitEntity =
  | Declaration
  | Literal
  | RawCode
  | NoEmit
  | CircularEmit;

export type Declaration = {
  kind: "declaration";
  scope: Scope;
  name: string;
  code: string | CodeBuilder;
};

export type Literal = {
  kind: "literal";
  code: string | CodeBuilder;
};

export type RawCode = {
  kind: "code";
  code: string | CodeBuilder;
};

export type NoEmit = {
  kind: "none";
  code: "";
};

export type CircularEmit = {
  kind: "circular";
  emitEntityKey: [string, Type, ContextState];
};

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
  lexicalContext?: Record<string, any>;
  referenceContext?: Record<string, any>;
}

export type Context = Record<string, any>;

export interface EmitterState {
  lexicalTypeStack: Type[],
  context: ContextState
}

export class TypeEmitter {
  constructor(protected emitter: AssetEmitter) {}

  programContext(program: Program) {
    return this.emitter.getContext();
  }

  namespace(namespace: Namespace): EmitEntity {
    for (const ns of namespace.namespaces.values()) {
      this.emitter.emitType(ns);
    }

    for (const model of namespace.models.values()) {
      this.emitter.emitType(model);
    }

    for (const operation of namespace.operations.values()) {
      this.emitter.emitType(operation);
    }

    for (const enumeration of namespace.enums.values()) {
      this.emitter.emitType(enumeration);
    }

    for (const union of namespace.unions.values()) {
      this.emitter.emitType(union);
    }

    for (const iface of namespace.interfaces.values()) {
      this.emitter.emitType(iface);
    }

    return this.emitter.result.none();
  }

  namespaceContext(namespace: Namespace): Context {
    return this.emitter.getContext();
  }
  namespaceReferenceContext(namespace: Namespace): 

  modelScalar(model: Model, scalarName: string): EmitEntity {
    return this.emitter.result.none();
  }

  modelScalarContext(model: Model, scalarName: string): ContextState {
    return this.emitter.getContext();
  }

  modelLiteral(model: Model): EmitEntity {
    if (model.baseModel) {
      this.emitter.emitType(model.baseModel);
    }

    this.emitter.emitModelProperties(model);
    return this.emitter.result.none();
  }

  modelLiteralContext(model: Model): ContextState {
    return this.emitter.getContext();
  }

  modelDeclaration(model: Model, name: string): EmitEntity {
    if (model.baseModel) {
      this.emitter.emitType(model.baseModel);
    }
    this.emitter.emitModelProperties(model);
    return this.emitter.result.none();
  }

  modelDeclarationContext(model: Model, name: string): ContextState {
    return this.emitter.getContext();
  }

  modelInstantiation(model: Model, name: string): EmitEntity {
    if (model.baseModel) {
      this.emitter.emitType(model.baseModel);
    }
    this.emitter.emitModelProperties(model);
    return this.emitter.result.none();
  }

  modelInstantiationContext(model: Model, name: string): ContextState {
    return this.emitter.getContext();
  }

  modelProperties(model: Model): EmitEntity {
    for (const prop of model.properties.values()) {
      this.emitter.emitModelProperty(prop);
    }

    return this.emitter.result.none();
  }

  modelPropertyLiteral(property: ModelProperty): EmitEntity {
    this.emitter.emitTypeReference(property.type);
    return this.emitter.result.none();
  }

  modelPropertyLiteralContext(property: ModelProperty): ContextState {
    return this.emitter.getContext();
  }

  modelPropertyReference(property: ModelProperty): EmitEntity {
    return this.emitter.result.rawCode(
      code`${this.emitter.emitTypeReference(property.type)}`
    );
  }

  booleanLiteralContext(boolean: BooleanLiteral): ContextState {
    return this.emitter.getContext();
  }
  booleanLiteral(boolean: BooleanLiteral): EmitEntity {
    return this.emitter.result.none();
  }

  sourceFile(sourceFile: SourceFile): EmittedSourceFile {
    const emittedSourceFile: EmittedSourceFile = {
      path: sourceFile.path,
      contents: "",
    };

    for (const decl of sourceFile.globalScope.declarations) {
      emittedSourceFile.contents += decl.code + "\n";
    }

    return emittedSourceFile;
  }

  reference(
    targetDeclaration: Declaration,
    pathUp: Scope[],
    pathDown: Scope[],
    commonScope: Scope | null
  ): EmitEntity {
    const basePath = pathDown.map((s) => s.name).join(".");
    return basePath
      ? this.emitter.result.rawCode(basePath + "." + targetDeclaration.name)
      : this.emitter.result.rawCode(targetDeclaration.name);
  }

  declarationName(declarationType: CadlDeclaration): string {
    if (!declarationType.name) {
      throw new Error("Can't emit a declaration that doesn't have a name");
    }

    if (declarationType.kind === "Enum") {
      return declarationType.name;
    }

    if (
      declarationType.templateArguments === undefined ||
      declarationType.templateArguments.length === 0
    ) {
      return declarationType.name;
    }

    // todo: this probably needs to be a lot more robust
    const parameterNames = declarationType.templateArguments.map((t) => {
      switch (t.kind) {
        case "Model":
          return this.emitter.emitDeclarationName(t);
        default:
          throw new Error(
            "Can't get a name for non-model type used to instantiate a model template"
          );
      }
    });

    return declarationType.name + parameterNames.join("");
  }
}

export function createEmitterContext(program: Program): EmitContext {
  return {
    program,
    AssetTag: {
      create(key) {
        return createAssetTagFactory(key);
      },
      language: createAssetTagFactory("language"),
    },
    createAssetEmitter(
      TypeEmitterClass: typeof TypeEmitter,
      ...tags: AssetTagInstance[]
    ): AssetEmitter {
      const sourceFiles: SourceFile[] = [];
      const typeId = CustomKeyMap.objectKeyer();
      const contextId = CustomKeyMap.objectKeyer();
      const typeToEmitEntity = new CustomKeyMap<[string, Type, ContextState], EmitEntity>(
        ([method, type, context]) => {
          return `${method}-${typeId.getKey(type)}-${contextId.getKey(context)}`;
        }
      );
      const waitingCircularRefs = new CustomKeyMap<[string, Type, ContextState], {
        state: EmitterState,
        cb: ((entity: EmitEntity) => EmitEntity)
      }[]>(
        ([method, type]) => {
          return `${method}-${typeId.getKey(type)}`;
        }
      )
      const knownContexts = new CustomKeyMap<
        [Type, ContextState],
        ContextState
      >(([type, context]) => {
        return `${typeId.getKey(type)}-${contextId.getKey(context)}`;
      });
      let lexicalTypeStack: Type[] = [];
      let context: ContextState = {};
      let programContext: ContextState | null = null;
      let incomingReferenceContext: Record<string, string> | null = null;

      const assetEmitter: AssetEmitter = {
        getContext() {
          return context;
        },
        getProgram() {
          return program;
        },
        result: {
          declaration(name, code) {
            const scope = currentScope();
            if (!scope) {
              throw new Error(
                "There is no current scope for this declaration, ensure you have called pushScope()."
              );
            }

            const entity: Declaration = {
              kind: "declaration",
              scope,
              name,
              code,
            };

            if (code instanceof CodeBuilder) {
              code.onComplete(value => entity.code = value);
            }
            return entity
          },
          literal(code) {
            const entity: Literal = {
              kind: "literal",
              code,
            };

            if (code instanceof CodeBuilder) {
              code.onComplete(value => entity.code = value);
            }
            return entity;
          },
          rawCode(code) {
            const entity: RawCode = {
              kind: "code",
              code,
            };

            if (code instanceof CodeBuilder) {
              code.onComplete(value => entity.code = value);
            }

            return {
              kind: "code",
              code,
            };
          },
          none() {
            return {
              kind: "none",
              code: "",
            };
          },
        },
        createScope(block, name, parentScope: Scope | null = null) {
          let newScope: Scope;
          if ("imports" in block) {
            // create source file scope
            newScope = {
              kind: "sourceFile",
              name,
              sourceFile: block,
              parentScope,
              childScopes: [],
              declarations: [],
            } as SourceFileScope;
          } else {
            newScope = {
              kind: "namespace",
              name,
              namespace: block,
              childScopes: [],
              declarations: [],
              parentScope,
            } as NamespaceScope;
          }

          parentScope?.childScopes.push(newScope);
          return newScope as any; // todo: fix?
        },

        createSourceFile(path): SourceFile {
          const sourceFile = {
            globalScope: undefined as any,
            path,
            imports: new Map(),
          };
          sourceFile.globalScope = this.createScope(sourceFile, "");
          sourceFiles.push(sourceFile);
          return sourceFile;
        },

        emitTypeReference(target): EmitEntity {
          if (target.kind === "ModelProperty") {
            return invokeTypeEmitter("modelPropertyReference", target);
          }

          incomingReferenceContext = context.referenceContext ?? null;

          const entity = this.emitType(target);

          let placeholder: Placeholder | null = null;

          if (entity.kind === "circular") {
            let waiting = waitingCircularRefs.get(entity.emitEntityKey);
            if (!waiting) {
              waiting = [];
              waitingCircularRefs.set(entity.emitEntityKey, waiting);
            }

            waiting.push({
              state: {
                lexicalTypeStack,
                context
              },
              cb: invokeReference
            })
            const builder = new CodeBuilder();
            placeholder = new Placeholder();
            builder.push(placeholder);
            return this.result.literal(builder);
          }

          return invokeReference(entity);

          
          function invokeReference(entity: EmitEntity) {
            if (entity.kind !== "declaration") {
              return entity;
            }
  
            const scope = currentScope();
            if (!scope) {
              throw new Error(
                "Can't generate a type reference without a current scope, ensure you have called pushScope"
              );
            }
  
            const targetScope = entity.scope;
            const targetChain = scopeChain(targetScope);
            const currentChain = scopeChain(scope);
            let diffStart = 0;
            while (
              targetChain[diffStart] &&
              currentChain[diffStart] &&
              targetChain[diffStart] === currentChain[diffStart]
            ) {
              diffStart++;
            }
  
            const pathUp: Scope[] = currentChain.slice(diffStart);
            const pathDown: Scope[] = targetChain.slice(diffStart);
            
            const ref = typeEmitter.reference(
              entity,
              pathUp,
              pathDown,
              targetChain[diffStart - 1] ?? null
            );

            if (placeholder) {
              if (ref.kind === "circular") {
                throw new Error("Circular resulted in circular?");
              }
              
              if (typeof ref.code !== "string") {
                // todo: maybe ok if this results in a code builder? But unlikely for references...
                throw new Error("still circular?");
              }

              placeholder.setValue(ref.code);
            }

            return ref;
          }

          function scopeChain(scope: Scope | null) {
            let chain = [];
            while (scope) {
              chain.unshift(scope);
              scope = scope.parentScope;
            }

            return chain;
          }
        },

        emitDeclarationName(type): string {
          return typeEmitter.declarationName!(type);
        },

        async writeOutput() {
          for (const file of sourceFiles) {
            const outputFile = typeEmitter.sourceFile(file);
            await program.host.writeFile(outputFile.path, outputFile.contents);
          }
        },

        emitType(type) {
          const key = typeEmitterKey(type);
          let args: any[];
          switch (key) {
            case "modelScalar":
              const intrinsicName = getIntrinsicModelName(program, type)!;
              args = [intrinsicName];
              break;
            case "modelDeclaration":
            case "modelInstantiation":
              const declarationName = typeEmitter.declarationName!(
                type as Model
              );
              args = [declarationName];
              break;
            default:
              args = [];
          }

          const result = (invokeTypeEmitter as any)(key, type, ...args);

          return result;
        },

        emitProgram(options) {
          const namespace = program.getGlobalNamespaceType();
          if (options?.emitGlobalNamespace) {
            this.emitType(namespace);
            return;
          }

          for (const ns of namespace.namespaces.values()) {
            if (ns.name === "Cadl" && !options?.emitCadlNamespace) continue;
            this.emitType(ns);
          }

          for (const model of namespace.models.values()) {
            console.log("emitting model " + model.name + " from program")
            this.emitType(model);
          }

          for (const operation of namespace.operations.values()) {
            this.emitType(operation);
          }

          for (const enumeration of namespace.enums.values()) {
            this.emitType(enumeration);
          }

          for (const union of namespace.unions.values()) {
            this.emitType(union);
          }

          for (const iface of namespace.interfaces.values()) {
            this.emitType(iface);
          }
        },

        emitModelProperties(model) {
          return typeEmitter.modelProperties(model);
        },

        emitModelProperty(property) {
          return invokeTypeEmitter("modelPropertyLiteral", property);
        },
      };

      const typeEmitter = new TypeEmitterClass(assetEmitter);
      return assetEmitter;

      function invokeTypeEmitter<
        T extends keyof Omit<
          TypeEmitter,
          | "sourceFile"
          | "declarationName"
          | "reference"
          | EndingWith<keyof TypeEmitter, "Context">
        >
      >(method: T, ...args: Parameters<TypeEmitter[T]>) {
        const type = args[0];
  
        let entity: EmitEntity;
        let emitEntityKey: [string, Type, ContextState];
        let cached = false;
        withTypeContext(type, () => {
          emitEntityKey = [method, type, context];
          const seenEmitEntity = typeToEmitEntity.get(emitEntityKey);

          if (seenEmitEntity) {
            entity = seenEmitEntity;
            cached = true;
            return;
          }

          typeToEmitEntity.set(emitEntityKey, { kind: "circular", emitEntityKey });
          entity = (typeEmitter[method] as any)(...args);
        });

        if (cached) {
          return entity!;
        }

        typeToEmitEntity.set(emitEntityKey!, entity!);
        const waitingRefCbs = waitingCircularRefs.get(emitEntityKey!);
        if (waitingRefCbs) {
          for (const record of waitingRefCbs) {
            withContext(record.state, () => { record.cb(entity); });
          }
          waitingCircularRefs.set(emitEntityKey!, []);
        }
        
        if (entity!.kind === "declaration") {
          entity!.scope.declarations.push(entity!);
        }

        return entity!;
      }

      function setContextForType(type: Type) {
        let newTypeStack;

        if (isDeclaration(type)) {
          newTypeStack = [type];
          let ns = type.namespace;
          while (ns) {
            if (ns.name === "") break;
            newTypeStack.unshift(ns);
            ns = ns.namespace;
          }
        } else {
          newTypeStack = [ ... lexicalTypeStack, type ];
        }

        lexicalTypeStack = newTypeStack;

        if (!programContext) {
          programContext = typeEmitter.programContext(program);
        }

        context = programContext;

        for (const contextChainEntry of lexicalTypeStack) {
          const seenContext = knownContexts.get([contextChainEntry, context]);
          if (seenContext) {
            context = seenContext;
            continue;
          }

          const key = typeEmitterKey(contextChainEntry) + "Context";
          const newContext = (typeEmitter as any)[key](contextChainEntry);
          knownContexts.set([contextChainEntry, context], newContext);
          context = newContext;
        }

        if (incomingReferenceContext) {
          context = {
            lexicalContext: context.lexicalContext,
            referenceContext: { ... context.referenceContext, ... incomingReferenceContext }
          };
          incomingReferenceContext = null;
        }
      }

      function withTypeContext(type: Type, cb: () => void) {
        const oldContext = context;
        const oldTypeStack = lexicalTypeStack;

        setContextForType(type);
        cb();

        context = oldContext;
        lexicalTypeStack = oldTypeStack;
      }

      function withContext(newContext: EmitterState, cb: () => void) {
        const oldContext = newContext.context;
        const oldTypeStack = newContext.lexicalTypeStack;
        context = newContext.context
        lexicalTypeStack = newContext.lexicalTypeStack;

        cb();

        context = oldContext;
        lexicalTypeStack = oldTypeStack;
      }

      function typeEmitterKey(type: Type) {
        switch (type.kind) {
          case "Model":
            const intrinsicName = getIntrinsicModelName(program, type);
            if (intrinsicName) {
              return "modelScalar";
            }

            if (type.name === "" || type.name === "Array") {
              return "modelLiteral";
            }

            if (
              type.templateArguments === undefined ||
              type.templateArguments.length === 0
            ) {
              return "modelDeclaration";
            }

            return "modelInstantiation";
          case "Namespace":
            return "namespace";
          case "ModelProperty":
            return "modelPropertyLiteral";
          case "Boolean":
            return "booleanLiteral";
          default:
            throw new Error("Unknown type: " + type.kind);
        }
      }
      function currentScope() {
        return (
          context.referenceContext?.scope ??
          context.lexicalContext?.scope ??
          null
        );
      }
    },
  };

  function createAssetTagFactory(key: string): AssetTagFactory {
    return function (value: string) {
      return { key, value };
    };
  }
}

export function isArrayType(m: Model) {
  return m.name === "Array";
}

export class Placeholder {
  #listeners: ((value: string) => void)[] = [];
  setValue(value: string) {
    for (const listener of this.#listeners) {
      listener(value);
    }
  }

  onValue(cb: (value:string) => void) {
    this.#listeners.push(cb);
  }
}

export class CodeBuilder {
  public segments: (string | Placeholder)[] = [];
  #placeholders: Set<Placeholder> = new Set();
  #listeners: ((value: string) => void)[] = [];

  #notifyComplete() {
    const value = this.segments.join("");
    for (const listener of this.#listeners) {
      listener(value);
    }
  }

  #setPlaceholderValue(ph: Placeholder, value: string) {
    for (const [i, segment] of this.segments.entries()) {
      if (segment === ph) {
        this.segments[i] = value;
      }
    }
    this.#placeholders.delete(ph);
    if (this.#placeholders.size === 0) {
      this.#notifyComplete();
    }
  }

  onComplete(cb: (value: string) => void) {
    this.#listeners.push(cb);
  }

  pushLiteralSegment(segment: string) {
    if (this.#shouldConcatLiteral()) {
      this.segments[this.segments.length - 1] += segment;
    } else {
      this.segments.push(segment);
    }
  }

  pushPlaceholder(ph: Placeholder) {
    this.#placeholders.add(ph);

    ph.onValue((value) => {
      this.#setPlaceholderValue(ph, value);
    });

    this.segments.push(ph);
  }

  pushCodeBuilder(builder: CodeBuilder) {
    for (const segment of builder.segments) {
      this.push(segment);
    }
  }

  push(segment: CodeBuilder | Placeholder | string) {
    if (typeof segment === "string") {
      this.pushLiteralSegment(segment);
    } else if (segment instanceof CodeBuilder) {
      this.pushCodeBuilder(segment);
    } else {
      this.pushPlaceholder(segment);
    }
  }

  reduce() {
    if (this.#placeholders.size === 0) {
      return this.segments.join("");
    }

    return this;
  }
  
  #shouldConcatLiteral() {
    return (
      this.segments.length > 0 &&
      typeof this.segments[this.segments.length - 1] === "string"
    );
  }
}

export function code(
  parts: TemplateStringsArray,
  ...substitutions: (EmitEntity | CodeBuilder | string)[]
): string | CodeBuilder {
  const builder = new CodeBuilder();

  for (const [i, literalPart] of parts.entries()) {
    builder.push(literalPart);
    if (i < substitutions.length) {
      const sub = substitutions[i];
      if (typeof sub === "string") {
        builder.push(sub);
      } else if (sub instanceof CodeBuilder) {
        builder.pushCodeBuilder(sub);
      } else if (sub.kind === "circular") {
        throw new Error("Circular reference!");
      } else {
        builder.push(sub.code);
      }
    }
  }

  return builder.reduce();
}

export class CustomKeyMap<K extends readonly any[], V> {
  #currentId = 0;
  #idMap = new WeakMap<object, number>();
  #items = new Map<string, V>();
  #keyer;

  constructor(keyer: (args: K) => string) {
    this.#keyer = keyer;
  }

  get(items: K): V | undefined {
    return this.#items.get(this.#keyer(items));
  }

  set(items: K, value: V): void {
    const key = this.#keyer(items);
    this.#items.set(key, value);
  }

  static objectKeyer() {
    const knownKeys = new WeakMap<object, number>();
    let count = 0;
    return {
      getKey(o: object) {
        if (knownKeys.has(o)) {
          return knownKeys.get(o);
        }

        let key = count;
        count++;
        knownKeys.set(o, key);
        return key;
      },
    };
  }
}

function isDeclaration(type: Type): type is CadlDeclaration | Namespace {
  switch(type.kind) {
    case "Namespace":
    case "Interface":
    case "Enum":
    case "Operation":
      return true;
    
    case "Model":
      return type.name ? type.name !== "" && type.name !== "Array" : false;
    case "Union":
      return type.name ? type.name !== "" : false;
    default:
      return false;
  }
}
