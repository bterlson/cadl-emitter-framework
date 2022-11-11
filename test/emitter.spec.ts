import {
  AssetEmitter,
  code,
  ContextState,
  createEmitterContext,
  Declaration,
  EmitContext,
  EmitEntity,
  EmittedSourceFile,
  Scope,
  SourceFile,
  SourceFileScope,
  TypeEmitter,
  CodeBuilder
} from "../src/framework.js";
import { createTSInterfaceEmitter } from "../src/index.js";
import { TypeScriptInterfaceEmitter } from "../src/TypescriptEmitter.js";
import { emitCadl, emitCadlFile, getHostForCadlFile } from "./host.js";
import {
  getIntrinsicModelName,
  Model,
  navigateProgram,
  getDoc,
  DecoratorContext,
  Type,
  ModelProperty,
  Namespace,
  Program,
  createDiagnosticCollector,
} from "@cadl-lang/compiler";
import prettier from "prettier";
import assert from "assert";

const testCode = `
model Basic { x: string }
model RefsOtherModel { x: Basic }
model HasNestedLiteral { x: { y: string } }
model HasArrayProperty { x: string[], y: Basic[] }
model IsArray is Array<string>;
model Derived extends Basic { }

@doc("Has a doc")
model HasDoc { @doc("an x property") x: string }

model Template<T> { prop: T }
model HasTemplates { x: Template<Basic> }
model IsTemplate is Template<Basic>;
model HasRef {
  x: Basic.x;
  y: RefsOtherModel.x;
}
`;

describe("typescript emitter", () => {
  it.skip("emits models to a single file by default", async (t) => {
    const host = await getHostForCadlFile(testCode);
    const program = host.program;
    const context = createEmitterContext(host.program);

    class SingleFileEmitter extends TypeScriptInterfaceEmitter {
      programContext() {
        const outputFile = emitter.createSourceFile("output.ts");
        return { lexicalContext: { scope: outputFile.globalScope } };
      }
    }
    const emitter = context.createAssetEmitter(
      SingleFileEmitter,
      context.AssetTag.language("typescript")
    );

    navigateProgram(program, {
      model(m) {
        if (m.namespace?.name === "Cadl") {
          return;
        }
        emitter.emitType(m);
      },
    });

    await emitter.writeOutput();

    console.log(host.fs.get("Z:/test/output.ts"));
  });

  it("emits to multiple files", async () => {
    const host = await getHostForCadlFile(testCode);
    const program = host.program;
    const context = createEmitterContext(host.program);

    class ClassPerFileEmitter extends TypeScriptInterfaceEmitter {
      modelDeclarationContext(model: Model): ContextState {
        const name = this.emitter.emitDeclarationName(model);
        const outputFile = this.emitter.createSourceFile(`${name}.ts`);

        return { lexicalContext: { scope: outputFile.globalScope } };
      }

      modelInstantiationContext(model: Model): ContextState {
        const name = this.emitter.emitDeclarationName(model);
        const outputFile = this.emitter.createSourceFile(`${name}.ts`);

        return { lexicalContext: { scope: outputFile.globalScope } };
      }

      modelLiteral(model: Model): EmitEntity {
        return super.modelLiteral(model);
      }
    }

    const emitter = context.createAssetEmitter(
      ClassPerFileEmitter,
      context.AssetTag.language("typescript")
    );

    navigateProgram(program, {
      model(m) {
        if (m.namespace?.name === "Cadl") {
          return;
        }
        emitter.emitType(m);
      },
    });

    await emitter.writeOutput();

    console.log(host.fs);
  });

  it("emits to namespaces", async () => {
    const host = await getHostForCadlFile(testCode);
    const program = host.program;
    const context = createEmitterContext(host.program);

    class NamespacedEmitter extends TypeScriptInterfaceEmitter {
      private nsByName: Map<string, Scope> = new Map();
      programContext(program: Program): ContextState {
        const outputFile = emitter.createSourceFile("output.ts");
        return {
          lexicalContext: {
            scope: outputFile.globalScope,
          },
        };
      }
      modelDeclarationContext(model: Model): ContextState {
        const name = this.emitter.emitDeclarationName(model);
        const nsName = name.slice(0, 1);
        let nsScope = this.nsByName.get(nsName);
        if (!nsScope) {
          nsScope = this.emitter.createScope(
            {},
            nsName,
            this.emitter.getContext().lexicalContext?.scope
          );
          this.nsByName.set(nsName, nsScope);
        }

        return {
          lexicalContext: {
            scope: nsScope,
          },
        };
      }

      sourceFile(sourceFile: SourceFile): EmittedSourceFile {
        const emittedSourceFile = super.sourceFile(sourceFile);
        emittedSourceFile.contents += emitNamespaces(sourceFile.globalScope);
        emittedSourceFile.contents = prettier.format(
          emittedSourceFile.contents,
          { parser: "typescript" }
        );
        return emittedSourceFile;

        function emitNamespaces(scope: Scope) {
          let res = "";
          for (const childScope of scope.childScopes) {
            res += emitNamespace(childScope);
          }
          return res;
        }
        function emitNamespace(scope: Scope) {
          let ns = `namespace ${scope.name} {\n`;
          ns += emitNamespaces(scope);
          for (const decl of scope.declarations) {
            ns += decl.code + "\n";
          }
          ns += `}\n`;

          return ns;
        }
      }
    }

    const emitter = context.createAssetEmitter(
      NamespacedEmitter,
      context.AssetTag.language("typescript")
    );

    navigateProgram(program, {
      model(m) {
        if (m.namespace?.name === "Cadl") {
          return;
        }
        emitter.emitType(m);
      },
    });

    await emitter.writeOutput();

    console.log(host.fs.get("Z:/test/output.ts"));
  });



  it("handles circular references", async () => {
    const host = await getHostForCadlFile(`
      model Foo { prop: Baz }
      model Baz { prop: Foo }
    `);
    const program = host.program;
    const context = createEmitterContext(host.program);

    class SingleFileEmitter extends TypeScriptInterfaceEmitter {
      programContext() {
        const outputFile = emitter.createSourceFile("output.ts");
        return { lexicalContext: { scope: outputFile.globalScope } };
      }
    }
    const emitter = context.createAssetEmitter(
      SingleFileEmitter,
      context.AssetTag.language("typescript")
    );

    navigateProgram(program, {
      model(m) {
        if (m.namespace?.name === "Cadl") {
          return;
        }
        emitter.emitType(m);
      },
    });

    await emitter.writeOutput();

    console.log(host.fs.get("Z:/test/output.ts"));
  })

});


it("handles circular references", async () => {
  let sourceFile: SourceFile;
  class TestEmitter extends TypeEmitter {
    programContext(program: Program): ContextState {
      sourceFile = this.emitter.createSourceFile("hi.txt");
      return {
        lexicalContext: {
          scope: sourceFile.globalScope
        }
      }
    }

    modelDeclaration(model: Model, name: string): EmitEntity {
      const result = this.emitter.emitModelProperties(model);
      return this.emitter.result.declaration(
        model.name,
        code`model references ${result}`
      );
    }

    modelProperties(model: Model): EmitEntity {
      const builder = new CodeBuilder();
      for (const prop of model.properties.values()) {
        builder.push(code`${this.emitter.emitModelProperty(prop)}`);
      }
      return this.emitter.result.literal(builder);
    }

    modelPropertyLiteral(property: ModelProperty): EmitEntity {
      return this.emitter.result.literal(code`${this.emitter.emitTypeReference(property.type)}`);
    }

    sourceFile(sourceFile: SourceFile): EmittedSourceFile {
      assert.strictEqual(sourceFile.globalScope.declarations.length, 2);

      for (const decl of sourceFile.globalScope.declarations) {
        if (decl.name === "Foo") {
          assert.strictEqual(decl.code, "model references Bar");
        } else {
          assert.strictEqual(decl.code, "model references Foo");
        }
      }

      return {
        contents: "",
        path: ""
      }
    }
  }

  await emitCadl(TestEmitter, `
    model Bar { bprop: Foo };
    model Foo { fprop: Bar };
  `, {
    modelDeclaration: 2,
    modelProperties: 2,
    modelPropertyLiteral: 2
  });
});

it("handles multiple circular references", async () => {
  let sourceFile: SourceFile;
  class TestEmitter extends TypeEmitter {
    programContext(program: Program): ContextState {
      sourceFile = this.emitter.createSourceFile("hi.txt");
      return {
        lexicalContext: {
          scope: sourceFile.globalScope
        }
      }
    }

    modelDeclaration(model: Model, name: string): EmitEntity {
      const result = this.emitter.emitModelProperties(model);
      return this.emitter.result.declaration(
        model.name,
        code`model references ${result}`
      );
    }

    modelProperties(model: Model): EmitEntity {
      const builder = new CodeBuilder();
      for (const prop of model.properties.values()) {
        builder.push(code`${this.emitter.emitModelProperty(prop)}`);
      }
      return this.emitter.result.literal(builder);
    }

    modelPropertyLiteral(property: ModelProperty): EmitEntity {
      return this.emitter.result.literal(code`${this.emitter.emitTypeReference(property.type)}`);
    }

    sourceFile(sourceFile: SourceFile): EmittedSourceFile {
      assert.strictEqual(sourceFile.globalScope.declarations.length, 3);

      for (const decl of sourceFile.globalScope.declarations) {
        if (decl.name === "Foo") {
          assert.strictEqual(decl.code, "model references BarBar");
        } else if (decl.name === "Bar") {
          assert.strictEqual(decl.code, "model references FooBaz");
        } else if (decl.name === "Baz") {
          assert.strictEqual(decl.code, "model references FooBar");
        }
      }

      return {
        contents: "",
        path: ""
      }
    }
  }

  await emitCadl(TestEmitter, `
    model Bar { prop: Foo, pro2: Baz };
    model Foo { prop: Bar, prop2: Bar };
    model Baz { prop: Foo, prop2: Bar };
  `, {
    modelDeclaration: 3,
    modelProperties: 3,
    modelPropertyLiteral: 6
  });
});
