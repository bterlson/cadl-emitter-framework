import {
  AssetEmitter,
  code,
  createEmitterContext,
  Declaration,
  EmitEntity,
  EmittedSourceFile,
  Scope,
  SourceFile,
  TypeEmitter,
  StringBuilder,
  Context,
  CadlDeclaration,
  EmitterOutput,
  CodeTypeEmitter,
  Placeholder,
  ObjectBuilder,
  ArrayBuilder
} from "../src/index.js";
import { TypeScriptInterfaceEmitter } from "../src/TypescriptEmitter.js";
import { emitCadl, getHostForCadlFile } from "./host.js";
import {
  Model,
  navigateProgram,
  Type,
  ModelProperty,
  Program,
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

  operationReturnTypeReferenceContext(
    operation: Operation,
    returnType: Type
  ): Context {
    return {
      fromOperation: true,
    };
  }

  modelDeclaration(model: Model, name: string): EmitterOutput<string> {
    const newName = this.emitter.getContext().fromOperation
      ? name + "FromOperation"
      : name;
    return super.modelDeclaration(model, newName);
  }
}

async function emitCadlToTs(code: string) {
  const emitter = await emitCadl(SingleFileEmitter, code, {}, false);

  const sf = await emitter
    .getProgram()
    .host.readFile("./cadl-output/output.ts");
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
    `);

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

  it("emits tuple types", async () => {
    const contents = await emitCadlToTs(`
      model Foo {
        x: [string, int32];
      }
    `);

    assert.match(contents, /x: \[string, number\]/);
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
    const contents = (
      await host.program.host.readFile("./cadl-output/output.ts")
    ).text;
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
        const outputFile = this.emitter.createSourceFile(
          `cadl-output/${name}.ts`
        );

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
      "Basic.ts",
      "RefsOtherModel.ts",
      "HasNestedLiteral.ts",
      "HasArrayProperty.ts",
      "IsArray.ts",
      "Derived.ts",
      "HasDoc.ts",
      "HasTemplates.ts",
      "TemplateBasic.ts",
      "IsTemplate.ts",
      "HasRef.ts",
      "SomeOp.ts",
      "MyEnum.ts",
      "UnionDecl.ts",
      "MyInterface.ts",
    ].forEach((file) => {
      assert(files.has(file));
    });
  });

  it("emits to namespaces", async () => {
    const host = await getHostForCadlFile(testCode);
    const context = createEmitterContext(host.program);

    class NamespacedEmitter extends TypeScriptInterfaceEmitter {
      private nsByName: Map<string, Scope<string>> = new Map();
      programContext(program: Program): Context {
        const outputFile = emitter.createSourceFile("output.ts");
        return {
          scope: outputFile.globalScope,
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

      sourceFile(sourceFile: SourceFile<string>): EmittedSourceFile {
        const emittedSourceFile = super.sourceFile(sourceFile);
        emittedSourceFile.contents += emitNamespaces(sourceFile.globalScope);
        emittedSourceFile.contents = prettier.format(
          emittedSourceFile.contents,
          { parser: "typescript" }
        );
        return emittedSourceFile;

        function emitNamespaces(scope: Scope<string>) {
          let res = "";
          for (const childScope of scope.childScopes) {
            res += emitNamespace(childScope);
          }
          return res;
        }
        function emitNamespace(scope: Scope<string>) {
          let ns = `namespace ${scope.name} {\n`;
          ns += emitNamespaces(scope);
          for (const decl of scope.declarations) {
            ns += decl.value + "\n";
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
    const emitter: AssetEmitter<string> = context.createAssetEmitter(
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
});

it("handles circular references", async () => {
  let sourceFile: SourceFile<string>;
  class TestEmitter extends CodeTypeEmitter {
    programContext(program: Program): Context {
      sourceFile = this.emitter.createSourceFile("hi.txt");
      return {
        scope: sourceFile.globalScope,
      };
    }

    modelDeclaration(model: Model, name: string): EmitterOutput<string> {
      const result = this.emitter.emitModelProperties(model);
      return this.emitter.result.declaration(
        model.name,
        code`model references ${result}`
      );
    }

    modelProperties(model: Model): EmitterOutput<string> {
      const builder = new StringBuilder();
      for (const prop of model.properties.values()) {
        builder.push(code`${this.emitter.emitModelProperty(prop)}`);
      }
      return this.emitter.result.rawCode(builder);
    }

    modelPropertyLiteral(property: ModelProperty): EmitterOutput<string> {
      return this.emitter.result.rawCode(
        code`${this.emitter.emitTypeReference(property.type)}`
      );
    }

    sourceFile(sourceFile: SourceFile<string>): EmittedSourceFile {
      assert.strictEqual(sourceFile.globalScope.declarations.length, 2);

      for (const decl of sourceFile.globalScope.declarations) {
        if (decl.name === "Foo") {
          assert.strictEqual(decl.value, "model references Bar");
        } else {
          assert.strictEqual(decl.value, "model references Foo");
        }
      }

      return {
        contents: "",
        path: "",
      };
    }
  }

  await emitCadl(
    TestEmitter,
    `
    model Bar { bprop: Foo };
    model Foo { fprop: Bar };
  `,
    {
      modelDeclaration: 2,
      modelProperties: 2,
      modelPropertyLiteral: 2,
    }
  );
});

it("handles multiple circular references", async () => {
  let sourceFile: SourceFile<string>;
  class TestEmitter extends CodeTypeEmitter {
    programContext(program: Program): Context {
      sourceFile = this.emitter.createSourceFile("hi.txt");
      return {
        scope: sourceFile.globalScope,
      };
    }

    modelDeclaration(model: Model, name: string): EmitterOutput<string> {
      const result = this.emitter.emitModelProperties(model);
      return this.emitter.result.declaration(
        model.name,
        code`model references ${result}`
      );
    }

    modelProperties(model: Model): EmitterOutput<string> {
      const builder = new StringBuilder();
      for (const prop of model.properties.values()) {
        builder.push(code`${this.emitter.emitModelProperty(prop)}`);
      }
      return this.emitter.result.rawCode(builder);
    }

    modelPropertyLiteral(property: ModelProperty): EmitterOutput<string> {
      return this.emitter.result.rawCode(
        code`${this.emitter.emitTypeReference(property.type)}`
      );
    }

    sourceFile(sourceFile: SourceFile<string>): EmittedSourceFile {
      assert.strictEqual(sourceFile.globalScope.declarations.length, 3);

      for (const decl of sourceFile.globalScope.declarations) {
        if (decl.name === "Foo") {
          assert.strictEqual(decl.value, "model references BarBar");
        } else if (decl.name === "Bar") {
          assert.strictEqual(decl.value, "model references FooBaz");
        } else if (decl.name === "Baz") {
          assert.strictEqual(decl.value, "model references FooBar");
        }
      }

      return {
        contents: "",
        path: "",
      };
    }
  }

  await emitCadl(
    TestEmitter,
    `
    model Bar { prop: Foo, pro2: Baz };
    model Foo { prop: Bar, prop2: Bar };
    model Baz { prop: Foo, prop2: Bar };
  `,
    {
      modelDeclaration: 3,
      modelProperties: 3,
      modelPropertyLiteral: 6,
    }
  );
});

describe("Object emitter", () => {
  function setValueOrPlaceholder<T>(
    obj: any,
    key: string,
    value: EmitEntity<T>,
    placeholderMarker: any
  ) {
    if (value instanceof Placeholder) {
      value.onValue((v) => (obj[key] = v));
      obj[key] = placeholderMarker;
    } else {
      obj[key] = value;
    }
  }

  function handlePlaceholders<T extends object>(obj: T): T {
    for (const [key, prop] of Object.entries(obj)) {
      if (prop instanceof Placeholder) {
        prop.onValue((v) => (obj[key as keyof T] = v));
      }
    }

    return obj;
  }

  class TestEmitter extends TypeEmitter<object> {
    programContext(program: Program): Context {
      const sourceFile = this.emitter.createSourceFile("test.json");
      return {
        scope: sourceFile.globalScope,
      };
    }

    modelDeclaration(model: Model, name: string): EmitterOutput<object> {
      const om = new ObjectBuilder({
        kind: "model",
        name,
        members: this.emitter.emitModelProperties(model),
      });

      return this.emitter.result.declaration(name, om);
    }

    modelLiteral(model: Model): EmitterOutput<object> {
      const om = new ObjectBuilder({
        kind: "anonymous model",
        members: this.emitter.emitModelProperties(model),
      });

      return om;
    }
    modelProperties(model: Model): EmitterOutput<object> {
      const members = new ArrayBuilder();

      for (const p of model.properties.values()) {
        members.push(this.emitter.emitModelProperty(p));
      }

      return members;
    }

    modelPropertyLiteral(property: ModelProperty): EmitterOutput<object> {
      const om = new ObjectBuilder({
        kind: "modelProperty",
        name: property.name,
        type: this.emitter.emitTypeReference(property.type),
      });

      return om;
    }

    reference(
      targetDeclaration: Declaration<object>,
      pathUp: Scope<object>[],
      pathDown: Scope<object>[],
      commonScope: Scope<object> | null
    ): object | EmitEntity<object> {
      return { $ref: targetDeclaration.name };
    }

    sourceFile(sourceFile: SourceFile<object>): EmittedSourceFile {
      const emittedSourceFile: EmittedSourceFile = {
        path: sourceFile.path,
        contents: "",
      };

      const obj: { declarations: object[] } = { declarations: [] };
      for (const decl of sourceFile.globalScope.declarations) {
        console.log("Have decl");
        if (decl.value instanceof Placeholder) {
          obj.declarations.push({ placeholder: true });
        } else {
          obj.declarations.push(decl.value);
        }
      }

      emittedSourceFile.contents = JSON.stringify(obj, null, 4);
      return emittedSourceFile;
    }
  }

  it("emits objects", async () => {
    const host = await getHostForCadlFile(
      `
      model Foo {
        bar: Bar
      }
      model Bar {
        x: Foo;
        y: {
          x: Foo
        };
      };
      `
    );
    const context = createEmitterContext(host.program);
    const assetEmitter = context.createAssetEmitter(TestEmitter);
    assetEmitter.emitProgram();
    await assetEmitter.writeOutput();
    const contents = JSON.parse(host.fs.get("Z:/test/test.json")!);
    assert.strictEqual(contents.declarations.length, 2);
  });
});
