import {
  Type,
  Program,
  Model,
  getIntrinsicModelName,
  Interface,
  Union,
  Operation,
  Enum
} from "@cadl-lang/compiler";
import { isArray } from "util";

export interface EmitContext {
  AssetTag: AssetTag;
  createAssetEmitter(...tags: AssetTagInstance[]): AssetEmitter;
}

export interface AssetEmitter {
  getTypeReference(type: Type): string;
  getDeclarationName(type: CadlDeclaration): string;
  createSourceFile(name: string): SourceFile;
  createScope(path: string, file: SourceFile): Scope;
  createDeclaration(type: Type, name: string, code: string): Declaration;
  createLiteral(type: Type, code: string): Literal;
  addTypeEmitter(emitter: TypeEmitter): void;
  emit(type: Type): void;
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

export type EmitEntity = Declaration | Literal;

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

export interface AssetTag {
  language: AssetTagFactory;
  create(key: string): AssetTagFactory;
}

export interface AssetTagInstance {}

export type AssetTagFactory = {
  (value: string): AssetTagInstance;
};

export type CustomListeners = {
  sourceFile: [
    [sourceFile: SourceFile, emitter: AssetEmitter],
    EmittedSourceFile
  ];
  reference: [
    [targetDeclaration: Declaration, sourceScope: Scope, emitter: AssetEmitter],
    string
  ];
  declarationName: [
    [declarationType: CadlDeclaration], string
  ]
};

export type CadlDeclaration = Model | Interface | Union | Operation | Enum;

export type TypeEmitter = {
  [type in Type["kind"] | keyof CustomListeners]?: type extends Type["kind"]
    ? {
        (type: Type & { kind: type }, emitter: AssetEmitter):
          | EmitEntity
          | EmitEntity[];
      }
    : type extends keyof CustomListeners
    ? { (...args: CustomListeners[type][0]): CustomListeners[type][1] }
    : never;
};

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
          console.log("Setting scope to ", scope);
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
          console.log("Creating decl for " + name + " in scope", scope);
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

        getTypeReference(target) {
          let entity = typeToEmitEntity.get(target);
          if (!entity) {
            this.emit(target);
            entity = typeToEmitEntity.get(target)!;
          }

          if (entity.kind === "literal") {
            return entity.code;
          }

          const emitter = getTypeEmitter();
          const scope = currentScope();
          if (!scope) {
            throw new Error("Can't generate a type reference without a current scope, ensure you have called pushScope")
          }
          return emitter.reference
            ? emitter.reference(entity, scope, this)
            : entity.name;
        },

        getDeclarationName(type) {
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

        emit(type) {
          if (typeToEmitEntity.has(type)) return;
          const emitter = getTypeEmitter();
          switch (type.kind) {
            case "Model":
              emitter.Model && addDecls(type, emitter.Model(type, this));
          }
        },
      };

      function getTypeEmitter(): TypeEmitter {
        if (!typeEmitter) throw new Error("TE not set");
        return typeEmitter;
      }

      function addDecls(type: Type, decls: EmitEntity | EmitEntity[]) {
        // todo: handle multiple return ?
        if (!Array.isArray(decls)) {
          typeToEmitEntity.set(type, decls);
          decls = [decls];
        }

        for (const decl of decls) {
          if (decl.kind !== "declaration") continue;
          decl.scope.declarations.push(decl);
          const file = decl.scope.sourceFile;
          file.declarations.push(decl);
        }
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
