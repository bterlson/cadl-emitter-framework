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
  CodeBuilder,
  Context,
  EmitEntityOrString,
  CadlDeclaration
} from "../src/index.js";
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
  Union,
  Enum,
  Interface,
  Operation,
} from "@cadl-lang/compiler";
import prettier from "prettier";
import assert from "assert";

const testCode = `
model Basic { x: string }
model RefsOtherModel { x: Basic, y: UnionDecl }
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

op SomeOp(x: string): string;

interface MyInterface {
  op get(): string;
}

union UnionDecl {
  x: int32;
  y: string;
}
enum MyEnum {
  a: "hi";
  b: "bye";
}
`;

class SingleFileEmitter extends TypeScriptInterfaceEmitter {
  programContext(): Context {
    const outputFile = this.emitter.createSourceFile("cadl-output/output.ts");
    return { scope: outputFile.globalScope };
  }
}


async function emitCadlToTs(code: string) {
  const emitter = await emitCadl(SingleFileEmitter, code);

  const sf = await emitter.getProgram().host.readFile("./cadl-output/output.ts");
  return sf.text;
}

describe("typescript emitter", () => {
  it("emits models", async () => {
    const contents = await emitCadlToTs(`
      model A {
        x: {
          y: string;
        },
      }
    `);
    
    assert.match(contents, /export interface A/);
    assert.match(contents, /x: \{ y: string \}/);
  });

  it("emits model templates", async () => {
    const contents = await emitCadlToTs(`
      model Template<T> {
        x: T
      }

      model Test1 is Template<string>;
      model Test2 {
        prop: Template<int32>;
      }
    `);

    assert.match(contents, /interface Test1/);
    assert.match(contents, /interface Templateint32/);
    assert.match(contents, /interface Test2/);
    assert.match(contents, /prop: Templateint32/);
  });

  it("emits literal types", async () => {
    const contents = await emitCadlToTs(`
      model A {
        x: true,
        y: "hi",
        z: 12
      }
    `);

    assert.match(contents, /x: true/);
    assert.match(contents, /y: "hi"/);
    assert.match(contents, /z: 12/);
  });

  // todo: what to do with optionals not at the end??
  it("emits operations", async () => {
    const contents = await emitCadlToTs(`
      model SomeModel {
        x: string;
      }
      op read(x: string, y: int32, z: { inline: true }, q?: SomeModel): string;
    `);

    assert.match(contents, /interface read/);
    assert.match(contents, /x: string/);
    assert.match(contents, /y: number/);
    assert.match(contents, /z: { inline: true }/);
    assert.match(contents, /q?: SomeModel/);
  });

  it("emits interfaces", async () => {
    const contents = await emitCadlToTs(`
      model Foo {
        prop: string;
      }
      op Callback(x: string): string;

      interface Things {
        op read(x: string): string;
        op write(y: Foo): Foo;
        op callCb(cb: Callback): string;
      }

      interface Template<T> {
        op read(): T;
        op write(): T;
      }

      interface TemplateThings extends Template<string> {}
    `)

    assert.match(contents, /export interface Things/);
    assert.match(contents, /read\(x: string\): string/);
    assert.match(contents, /write\(y: Foo\): Foo/);
    assert.match(contents, /callCb\(cb: Callback\): string/);
    assert.match(contents, /export interface TemplateThings/);
    assert.match(contents, /read\(\): string/);
    assert.match(contents, /write\(\): string/);
  });

  it("emits enums", async () => {
    const contents = await emitCadlToTs(`
      enum StringEnum {
        x; y: "hello";
      }

      enum NumberEnum {
        x: 1;
        y: 2;
        z: 3;
      }
    `);

    assert.match(contents, /enum StringEnum/);
    assert.match(contents, /x = "x"/);
    assert.match(contents, /y = "hello"/);
    assert.match(contents, /x = 1/);
  });

  it("emits unions", async () => {
    const contents = await emitCadlToTs(`
      model SomeModel {
        a: 1 | 2 | SomeModel;
        b: TU<string>;
      };

      union U {
        x: 1,
        y: "hello",
        z: SomeModel
      }

      union TU<T> {
        x: T;
        y: null;
      }

    `);

    assert.match(contents, /a: 1 \| 2 \| SomeModel/);
    assert.match(contents, /b: TUstring/);
    assert.match(contents, /export type U = 1 \| "hello" \| SomeModel/);
    assert.match(contents, /export type TUstring = string \| null/);
  });

  it("emits models to a single file", async () => {
    const host = await getHostForCadlFile(testCode);
    const program = host.program;
    const context = createEmitterContext(host.program);


    const emitter = context.createAssetEmitter(
      SingleFileEmitter,
      context.AssetTag.language("typescript")
    );

    emitter.emitProgram();
    await emitter.writeOutput();

    const files = await host.program.host.readDir("./cadl-output");
    assert.strictEqual(files.length, 1);
    const contents = (await host.program.host.readFile("./cadl-output/output.ts")).text;
    // some light assertions
    assert.match(contents, /export interface Basic/);
    assert.match(contents, /export interface HasRef/);
  });

  it("emits to multiple files", async () => {
    const host = await getHostForCadlFile(testCode);
    const context = createEmitterContext(host.program);

    class ClassPerFileEmitter extends TypeScriptInterfaceEmitter {
      modelDeclarationContext(model: Model): Context {
        return this.#declarationContext(model);
      }

      modelInstantiationContext(model: Model): Context {
        return this.#declarationContext(model);
      }

      unionDeclarationContext(union: Union): Context {
        return this.#declarationContext(union);
      }

      unionInstantiationContext(union: Union): Context {
        return this.#declarationContext(union);
      }

      enumDeclarationContext(en: Enum): Context {
        return this.#declarationContext(en);
      }

      interfaceDeclarationContext(iface: Interface): Context {
        return this.#declarationContext(iface);
      }

      operationDeclarationContext(operation: Operation): Context {
        return this.#declarationContext(operation);
      }

      #declarationContext(decl: CadlDeclaration) {
        const name = this.emitter.emitDeclarationName(decl);
        const outputFile = this.emitter.createSourceFile(`cadl-output/${name}.ts`);

        return { scope: outputFile.globalScope };
      }
    }

    const emitter = context.createAssetEmitter(
      ClassPerFileEmitter,
      context.AssetTag.language("typescript")
    );

    emitter.emitProgram();

    await emitter.writeOutput();

    const files = new Set(await host.program.host.readDir("./cadl-output"));
    [
      'Basic.ts',
      'RefsOtherModel.ts',
      'HasNestedLiteral.ts',
      'HasArrayProperty.ts',
      'IsArray.ts',
      'Derived.ts',
      'HasDoc.ts',
      'HasTemplates.ts',
      'TemplateBasic.ts',
      'IsTemplate.ts',
      'HasRef.ts',
      'SomeOp.ts',
      'MyEnum.ts',
      'UnionDecl.ts',
      'MyInterface.ts'
    ].forEach(file => {
      assert(files.has(file));
    })
  });

  it("emits to namespaces", async () => {
    const host = await getHostForCadlFile(testCode);
    const program = host.program;
    const context = createEmitterContext(host.program);

    class NamespacedEmitter extends TypeScriptInterfaceEmitter {
      private nsByName: Map<string, Scope> = new Map();
      programContext(program: Program): Context {
        const outputFile = emitter.createSourceFile("output.ts");
        return {
          scope: outputFile.globalScope
        };
      }

      modelDeclarationContext(model: Model): Context {
        const name = this.emitter.emitDeclarationName(model);
        const nsName = name.slice(0, 1);
        let nsScope = this.nsByName.get(nsName);
        if (!nsScope) {
          nsScope = this.emitter.createScope(
            {},
            nsName,
            this.emitter.getContext().scope
          );
          this.nsByName.set(nsName, nsScope);
        }

        return {
          scope: nsScope,
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

    emitter.emitProgram();

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
        return { scope: outputFile.globalScope };
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
    programContext(program: Program): Context {
      sourceFile = this.emitter.createSourceFile("hi.txt");
      return {
        scope: sourceFile.globalScope
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
    programContext(program: Program): Context {
      sourceFile = this.emitter.createSourceFile("hi.txt");
      return {
        scope: sourceFile.globalScope
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