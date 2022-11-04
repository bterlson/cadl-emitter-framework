import { AssetEmitter, ContextState, createEmitterContext, Declaration, EmitContext, EmitEntity, EmittedSourceFile, Scope, SourceFile, SourceFileScope, TypeEmitter } from "../src/framework.js";
import { createTSInterfaceEmitter } from "../src/index.js";
import { TypeScriptInterfaceEmitter } from "../src/TypescriptEmitter.js";
import test from "ava";
import {emitCadlFile, getHostForCadlFile} from "./host.js";
import { getIntrinsicModelName, Model, navigateProgram, getDoc, DecoratorContext, Type, ModelProperty, Namespace } from "@cadl-lang/compiler";
import prettier from "prettier";

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
test.skip('emits models to a single file by default', async (t) => {
  const host = await getHostForCadlFile(testCode);
  const program = host.program;
  const context = createEmitterContext(host.program);
  const emitter = context.createAssetEmitter(
    TypeScriptInterfaceEmitter,
    context.AssetTag.language("typescript")
  );
  const outputFile = emitter.createSourceFile("output.ts");
  emitter.setScope(outputFile.globalScope);

  navigateProgram(program, {
    model(m) {
      if (m.namespace?.name === "Cadl") { return }
      emitter.emitType(m)
    }
  });

  await emitter.writeOutput();

  console.log(host.fs.get("Z:/test/output.ts"));
});

test.skip("emits to multiple files", async () => {
  const host = await getHostForCadlFile(testCode);
  const program = host.program;
  const context = createEmitterContext(host.program);
  
  class ClassPerFileEmitter extends TypeScriptInterfaceEmitter {
    modelDeclaration(model: Model, name: string): EmitEntity {
      const outputFile = this.emitter.createSourceFile(`${name}.ts`);
      this.emitter.setScope(outputFile.globalScope);

      return super.modelDeclaration(model, name);
    }
  }

  const emitter = context.createAssetEmitter(ClassPerFileEmitter, context.AssetTag.language("typescript"));

  navigateProgram(program, {
    model(m) {
      if (m.namespace?.name === "Cadl") { return }
      emitter.emitType(m)
    }
  });

  await emitter.writeOutput();

  console.log(host.fs);
});

test.skip("emits to namespaces", async () => {
  const host = await getHostForCadlFile(testCode);
  const program = host.program;
  const context = createEmitterContext(host.program);


  class NamespacedEmitter extends TypeScriptInterfaceEmitter {
    private nsByName: Map<string, Scope> = new Map();
    
    modelDeclaration(model: Model, name: string): EmitEntity {
      const nsName = name.slice(0, 1);
      let nsScope = this.nsByName.get(nsName);
      if (!nsScope) {
        nsScope = this.emitter.createScope({},nsName, this.emitter.getContext().scope);
        this.nsByName.set(nsName, nsScope);
      }

      this.emitter.setScope(nsScope);

      return super.modelDeclaration(model, name);
    }

    sourceFile(sourceFile: SourceFile): EmittedSourceFile {
      const emittedSourceFile = super.sourceFile(sourceFile);
      emittedSourceFile.contents += emitNamespaces(sourceFile.globalScope);
      emittedSourceFile.contents = prettier.format(emittedSourceFile.contents, { parser: "typescript" })
      return emittedSourceFile;

      function emitNamespaces(scope: Scope) {
        let res = '';
        for (const childScope of scope.childScopes) {
          res += emitNamespace(childScope);
        }
        return res;
      }
      function emitNamespace(scope: Scope) {
        let ns = `namespace ${scope.name} {\n`
        ns += emitNamespaces(scope);
        for (const decl of scope.declarations) {
          ns += decl.code + "\n";
        }
        ns += `}\n`

        return ns;
      }
    }
  }

  const emitter = context.createAssetEmitter(NamespacedEmitter, context.AssetTag.language("typescript"));
  const outputFile = emitter.createSourceFile("output.ts");
  emitter.setScope(outputFile.globalScope);

  navigateProgram(program, {
    model(m) {
      if (m.namespace?.name === "Cadl") { return }
      emitter.emitType(m)
    }
  });

  await emitter.writeOutput();

  console.log(host.fs.get("Z:/test/output.ts"));
});


test("context applies to current emit frame", async (t) => {
  t.plan(2);

  const context = await createEmitContext(`
    model A { }
    model B { }
  `);
  let scope: Scope | null = null;
  class TestEmitter extends TypeEmitter {
    modelDeclarationContext(model: Model, name: string): ContextState {
      if (name === "A") {
        scope = this.emitter.createScope({}, "A");
        return { lexicalContext: {scope }};
      }

      return this.emitter.getContext();
    }

    modelDeclaration(model: Model, name: string): EmitEntity {
      if (name === "A") {
        t.is(this.emitter.getContext().lexicalContext?.scope, scope, `scope for A`);
      } else {
        t.is(this.emitter.getContext().lexicalContext?.scope, undefined, `scope for B`);
      }
      

      return this.emitter.result.none();
    }
  }

  emitModels(context, TestEmitter);
});

test("context is preserved for items in the same lexical context", async (t) => {
  t.plan(2);

  const context = await createEmitContext(`
    model A { prop: string }
  `);

  let scope: Scope | null = null;
  
  class TestEmitter extends TypeEmitter {
    modelDeclarationContext(model: Model, name: string): ContextState {
      scope = this.emitter.createScope({}, "A");
      return {
        lexicalContext: {
          scope
        }
      }
    }

    modelDeclaration(model: Model, name: string): EmitEntity {
      t.is(this.emitter.getContext().lexicalContext?.scope, scope, `scope for ${model.name}`);
      return super.modelDeclaration(model, name);
    }

    modelPropertyLiteral(property: ModelProperty): EmitEntity {
      t.is(this.emitter.getContext().lexicalContext?.scope, scope, `scope for model property`);
      return this.emitter.result.none();
    }
  }

  emitModels(context, TestEmitter);
});

test("namespace context is preserved for models in that namespace", async (t) => {
  t.plan(2);
  const context = await createEmitContext(`
    model Bar { prop: A.Foo };
    namespace A {
      model Foo { prop: string };
    }
  `)

  class TestEmitter extends TypeEmitter {
    namespaceContext(namespace: Namespace): ContextState {
      return {
        lexicalContext: {
          inANamespace: namespace.name === "A"
        }
      }
    }

    modelDeclaration(model: Model, name: string): EmitEntity {
      const context = this.emitter.getContext();
      if (name === "Foo") {
        t.assert(context.lexicalContext?.inANamespace);  
      } else {
        t.assert(!context.lexicalContext?.inANamespace);
      }
      
      return super.modelDeclaration(model, name);
    }
  }
  
  emitModels(context, TestEmitter);
});

test.only("handles circular references", async (t) => {
  const context = await createEmitContext(`
    model Bar { prop: Foo };
    model Foo { prop: Bar };
  `);
  let called = 0;
  class TestEmitter extends TypeEmitter {
    modelDeclaration(model: Model, name: string): EmitEntity {
      called++;
      return super.modelDeclaration(model, name);
    }
  }
  emitModels(context, TestEmitter);
  t.is(called, 2);
});

async function createEmitContext(code: string) {
  const host = await getHostForCadlFile(code);
  return createEmitterContext(host.program);
}

async function emitModels(context: EmitContext, typeEmitter: typeof TypeEmitter) {
  const emitter = context.createAssetEmitter(typeEmitter, {});
  navigateProgram(context.program, {
    model(m) {
      if (m.namespace?.name === "Cadl") { return }
      console.log("Visiting model", m.name);
      emitter.emitType(m)
    }
  });
}

async function emitNamespaces(context: EmitContext, typeEmitter: typeof TypeEmitter) {
  const emitter = context.createAssetEmitter(typeEmitter, {});
  navigateProgram(context.program, {
    namespace(n) {
      if (n.name === "Cadl") { return }
      emitter.emitType(n);
    }
  });
}