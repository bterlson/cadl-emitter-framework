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
  getContext(): ContextState;
  getProgram(): Program;
  emitTypeReference(type: Type): string;
  emitDeclarationName(type: CadlDeclaration): string;
  emitType(type: Type): string;
  emitModelProperties(model: Model): string;
  emitModelProperty(prop: ModelProperty): string;
  createSourceFile(name: string): SourceFile;
  createScope(sourceFile: SourceFile, name: string): SourceFileScope;
  createScope(namespace: any, name: string, parentScope: Scope): NamespaceScope;
  createScope(block: any, name: string, parentScope?: Scope | null): Scope;
  result: {
    declaration(type: Type, name: string, code: string): Declaration;
    literal(type: Type, code: string): Literal;
    rawCode(code: string): RawCode;
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

export type EmitEntity = Declaration | Literal | RawCode | NoEmit | CircularEmit;

export type Declaration = {
  kind: "declaration";
  scope: Scope;
  name: string;
  code: string;
};

export type Literal = {
  kind: "literal";
  code: string;
};

export type RawCode = {
  kind: "code";
  code: string;
};

export type NoEmit = {
  kind: "none";
  code: "";
};

export type CircularEmit = {
  kind: "circular",
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
  lexicalContext?: Record<string, any>;
  referenceContext?: Record<string, any>;
}

export class TypeEmitter {
  constructor(protected emitter: AssetEmitter) {}

  namespace(namespace: Namespace): EmitEntity {
    return this.emitter.result.none();
  }

  namespaceContext(namespace: Namespace): ContextState {
    return this.emitter.getContext();
  }

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

  modelDeclarationContext(
    model: Model,
    name: string
  ): ContextState {
    return this.emitter.getContext();
  }

  modelInstantiation(model: Model, name: string): EmitEntity {
    if (model.baseModel) {
      this.emitter.emitType(model.baseModel);
    }
    this.emitter.emitModelProperties(model);
    return this.emitter.result.none();
  }

  modelInstantiationContext(
    model: Model,
    name: string
  ): ContextState {
    return this.emitter.getContext();
  }

  modelProperties(model: Model): EmitEntity {
    for (const prop of model.properties.values()) {
      this.emitter.emitModelProperty(prop);
    }

    return this.emitter.result.none();
  }

  modelPropertyLiteral(property: ModelProperty): EmitEntity {
    this.emitter.emitType(property.type);
    return this.emitter.result.none();
  }

  modelPropertyLiteralContext(property: ModelProperty): ContextState {
    return this.emitter.getContext();
  }

  modelPropertyReference(property: ModelProperty): EmitEntity {
    return this.emitter.result.rawCode(
      this.emitter.emitTypeReference(property.type)
    );
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
  ): string {
    const basePath = pathDown.map((s) => s.name).join(".");
    return basePath
      ? basePath + "." + targetDeclaration.name
      : targetDeclaration.name;
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
      const typeToEmitEntity = new Map<Type, EmitEntity>();
      let context: ContextState = {};
      const circularMarker: CircularEmit = {
        kind: "circular"
      }

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
            return {
              kind: "declaration",
              scope,
              name,
              code,
            };
          },
          literal(code) {
            return {
              kind: "literal",
              code,
            };
          },
          rawCode(code) {
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

        emitTypeReference(target): string {
          if (target.kind === "ModelProperty") {
            return invokeTypeEmitter("modelPropertyReference", target);
          }

          let entity = typeToEmitEntity.get(target);
          if (!entity) {
            this.emitType(target);
            entity = typeToEmitEntity.get(target)!;
          }

          if (entity.kind === "circular") {
            return entity;
          }

          if (entity.kind === "none") {
            return "";
          }

          if (entity.kind === "code") {
            return entity.code;
          }

          if (entity.kind === "literal") {
            return entity.code;
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
          return typeEmitter.reference(
            entity,
            pathUp,
            pathDown,
            targetChain[diffStart - 1] ?? null
          );

          function scopeChain(scope: Scope | null) {
            let chain = [];
            while (scope) {
              chain.unshift(scope);
              scope = scope.parentScope;
            }

            return chain;
          }
        },

        emitDeclarationName(type) {
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
              args = [ intrinsicName ];
              break;
            case "modelDeclaration":
            case "modelInstantiation":
              const declarationName = typeEmitter.declarationName!(type as Model);
              args = [ declarationName ];
              break;
            default:
              args = [];
          }

          const result = (invokeTypeEmitter as any)(key, type, ... args);

          return result;
        },

        emitModelProperties(model) {
          return typeEmitter.modelProperties(model).code;
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
      >(method: T, ... args: Parameters<TypeEmitter[T]>) {
        const type = args[0];
        const oldContext = context;
        setContextForType(args[0]);

        const seenEmitEntity = typeToEmitEntity.get(type);
        if (seenEmitEntity) {
          if (seenEmitEntity.kind === "circular") {
            return seenEmitEntity;
          }

          return seenEmitEntity.code;
        }

        typeToEmitEntity.set(type, circularMarker);
        const entity: EmitEntity = (typeEmitter[method] as any)(...args);
        context = oldContext;

        typeToEmitEntity.set(type, entity);

        if (entity.kind === "declaration") {
          entity.scope.declarations.push(entity);
        }

        return entity.code;
      }

      function setContextForType(type: Type) {
        const key = typeEmitterKey(type) + 'Context';
        
        if ("namespace" in type && type.namespace) {
          setContextForType(type.namespace);
        }

        console.log("Calling type emitter key: ", key);
        const newContext = (typeEmitter as any)[key](type);

        context = {
          lexicalContext: {
            ... context?.lexicalContext ?? {},
            ... newContext?.lexicalContext ?? {}
          },
          referenceContext: {
            ... context?.referenceContext ?? {},
            ... newContext?.referenceContext ?? {}
          }
        }
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

            return "modelInstantiation"
          case "Namespace":
            return "namespace";
          case "ModelProperty":
            return "modelPropertyLiteral";
          default:
            throw new Error("Unknown type: " + type.kind);
        }        
      }
      function currentScope() {
        return context.referenceContext?.scope ?? context.lexicalContext?.scope ?? null;
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
