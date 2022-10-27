import {
  Type,
  Program,
  Model,
  getIntrinsicModelName,
  Interface,
  Union,
  Operation,
  Enum,
  ModelProperty
} from "@cadl-lang/compiler";

export interface EmitContext {
  AssetTag: AssetTag;
  createAssetEmitter(...tags: AssetTagInstance[]): AssetEmitter;
}

export interface AssetEmitter {

  emitTypeReference(type: Type): string;
  emitDeclarationName(type: CadlDeclaration): string;
  emitType(type: Type): string;
  emitModelProperties(model: Model, properties: Model["properties"]): string;
  emitModelProperty(prop: ModelProperty): string;
  createSourceFile(name: string): SourceFile;
  createScope(path: string, file: SourceFile): Scope;
  createDeclaration(type: Type, name: string, code: string): Declaration;
  createLiteral(type: Type, code: string): Literal;
  addTypeEmitter(emitter: TypeEmitter): void;
  writeOutput(): Promise<void>;
  pushScope(scope: Scope): void;
  popScope(): void;
  setScope(scope: Scope | Scope[]): Scope[];
  restoreScope(scope: Scope | Scope[]): void;
}

export interface Scope {
  name: string;
  sourceFile: SourceFile;
  parentScope: Scope | null;
  declarations: Declaration[];
}

export interface TypeReference {
  expression: string;
}

export interface SourceFile {
  path: string;
  globalScope: Scope;
  declarations: Declaration[];
  imports: Map<string, string[]>;
}

export interface EmittedSourceFile {
  contents: string;
  path: string;
}

export type EmitEntity = Declaration | Literal | RawCode;

export type Declaration = {
  kind: "declaration",
  scope: Scope;
  name: string;
  type: Type;
  code: string;
};

export type Literal = {
  kind: "literal",
  code: string;
  type: Type;
}

export type RawCode = {
  kind: "code",
  code: string;
}

export type EmitEntityOrString = EmitEntity | string;

export interface AssetTag {
  language: AssetTagFactory;
  create(key: string): AssetTagFactory;
}

export interface AssetTagInstance {}

export type AssetTagFactory = {
  (value: string): AssetTagInstance;
};

export type CadlDeclaration = Model | Interface | Union | Operation | Enum;

export interface TypeEmitter {
  Model: {
    scalar(model: Model, scalarName: string): EmitEntityOrString;
    literal(model: Model): EmitEntityOrString;
    declaration(model: Model, name: string): EmitEntityOrString;
    properties(model: Model, properties: Model["properties"]): string; // hmm
  };
  ModelProperty: {
    literal(property: ModelProperty): EmitEntityOrString;
    reference(property: ModelProperty): string;
  }
  sourceFile(sourceFile: SourceFile, emitter: AssetEmitter): EmittedSourceFile;
  reference(targetDeclaration: Declaration, sourceScope: Scope, emitter: AssetEmitter): string;
  declarationName?(declarationType: CadlDeclaration): string;
}

export function createEmitterContext(program: Program): EmitContext {
  return {
    AssetTag: {
      create(key) {
        return createAssetTagFactory(key);
      },
      language: createAssetTagFactory("language"),
    },
    createAssetEmitter(...tags: AssetTagInstance[]): AssetEmitter {
      const sourceFiles: SourceFile[] = [];
      const typeToEmitEntity = new Map<Type, EmitEntity>();
      let typeEmitter: TypeEmitter | null = null;
      let scopeStack: Scope[] = [];

      return {
        pushScope(scope) {
          scopeStack.push(scope);
        },
        popScope() {
          scopeStack.pop();
        },
        setScope(scope) {
          if (!Array.isArray(scope)) {
            scope = [scope]
          }
          const oldScope = scopeStack;
          scopeStack = scope;
          return oldScope;
        },
        restoreScope(scope) {
          if (!Array.isArray(scope)) {
            scope = [scope]
          }
          scopeStack = scope;
        },
        createDeclaration(type, name, code) {
          const scope = currentScope();
          if (!scope) {
            throw new Error("There is no current scope for this declaration, ensure you have called pushScope().")
          }
          return {
            kind: 'declaration',
            scope,
            name,
            type,
            code
          }
        },
        createLiteral(type, code) {
          return {
            kind: 'literal',
            type,
            code
          }
        },
        createScope(name, sourceFile, parentScope: Scope | null = null) {
          return {
            name,
            sourceFile,
            parentScope: parentScope,
            declarations: [],
          };
        },

        createSourceFile(path): SourceFile {
          const sourceFile = {
            declarations: [],
            globalScope: undefined as any,
            path,
            imports: new Map()
          };
          sourceFile.globalScope = this.createScope("", sourceFile);
          sourceFiles.push(sourceFile);
          return sourceFile;
        },

        emitTypeReference(target) {
          const emitter = getTypeEmitter();

          if (target.kind === "ModelProperty") {
            return emitter.ModelProperty.reference(target);
          }

          let entity = typeToEmitEntity.get(target);
          if (!entity) {
            this.emitType(target);
            entity = typeToEmitEntity.get(target)!;
          }

          if (entity.kind === "code") {
            return entity.code;
          }

          if (entity.kind === "literal") {
            return entity.code;
          }

          const scope = currentScope();
          if (!scope) {
            throw new Error("Can't generate a type reference without a current scope, ensure you have called pushScope")
          }
          return emitter.reference
            ? emitter.reference(entity, scope, this)
            : entity.name;
        },

        emitDeclarationName(type) {
          const emitter = getTypeEmitter();
          return emitter.declarationName!(type);
        },

        async writeOutput() {
          const emitter = getTypeEmitter();
          if (!emitter.sourceFile) return;
          for (const file of sourceFiles) {
            const outputFile = emitter.sourceFile(file, this);
            await program.host.writeFile(outputFile.path, outputFile.contents);
          }
        },
        
        addTypeEmitter(emitter) {
          if (!emitter.declarationName) {
            emitter.declarationName = defaultEmitDeclarationName;
          }
          typeEmitter = emitter;
        },

        emitType(type) {
          const seenEmitEntity = typeToEmitEntity.get(type);

          if (seenEmitEntity) return seenEmitEntity.code;
          const emitter = getTypeEmitter();
          switch (type.kind) {
            case "Model":
              const intrinsicName = getIntrinsicModelName(program, type);
              if (intrinsicName) {
                return addDecls(type, stringToEntity(emitter.Model.scalar(type, intrinsicName)));
              }

              if (type.name === "" || type.name === "Array") {
                return addDecls(type, stringToEntity(emitter.Model.literal(type)))
              }

              const declName = emitter.declarationName!(type);

              return addDecls(type, stringToEntity(emitter.Model.declaration(type, declName)));
            default:
              return "";
          }
        },

        emitModelProperties(model, properties) {
          return getTypeEmitter().Model.properties(model, properties);
        },

        emitModelProperty(property) {
          return addDecls(property, stringToEntity(getTypeEmitter().ModelProperty.literal(property)))
        }
      };

      function getTypeEmitter(): TypeEmitter {
        if (!typeEmitter) throw new Error("TE not set");
        return typeEmitter;
      }

      function addDecls(type: Type, decl: EmitEntity) {
        typeToEmitEntity.set(type, decl);
        if (decl.kind === "declaration") {
          decl.scope.declarations.push(decl);
          const file = decl.scope.sourceFile;
          file.declarations.push(decl);
        }

        return decl.code;
      }

      function stringToEntity(entity: EmitEntityOrString): EmitEntity {
        if (typeof entity === "string") {
          return { kind: "code", code: entity }
        }
        return entity;
      }

      function currentScope() {
        if (scopeStack.length === 0) return null;
        return scopeStack[scopeStack.length - 1];

      }

      function defaultEmitDeclarationName(declarationType: CadlDeclaration): string {
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
              return defaultEmitDeclarationName(t);
            default:
              throw new Error(
                "Can't get a name for non-model type used to instantiate a model template"
              );
          }
        });
      
        return declarationType.name + parameterNames.join("");
      }
    },
  };

  function createAssetTagFactory(key: string): AssetTagFactory {
    return function (value: string) {
      return { key, value };
    };
  }
}
