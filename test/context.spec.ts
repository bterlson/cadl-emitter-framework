import { Model, ModelProperty, Namespace, Program } from "@cadl-lang/compiler";
import {
  Context,
  CodeTypeEmitter,
  EmitterOutput,
} from "../src/index.js";
import { emitCadl } from "./host.js";
import assert from "assert";

describe("emitter context", async () => {
  describe("program context", async () => {
    it("should be initialized to empty state", async () => {
      class Emitter extends CodeTypeEmitter {
        modelDeclaration(model: Model, name: string): EmitterOutput<string> {
          const context = this.emitter.getContext();
          assert.deepStrictEqual(context, {});
          return super.modelDeclaration(model, name);
        }
      }

      await emitCadl(Emitter, `model Foo { }`);
    });

    it("should set program state for the whole program", async () => {
      class Emitter extends CodeTypeEmitter {
        programContext(program: Program) {
          return {
            inProgram: true,
          };
        }
        modelDeclaration(model: Model, name: string): EmitterOutput<string> {
          const context = this.emitter.getContext();
          assert.deepStrictEqual(context, { inProgram: true });
          return super.modelDeclaration(model, name);
        }
      }

      await emitCadl(Emitter, `model Foo { }`);
    });
  });

  describe("namespace context", () => {
    it("should set context for everything inside the namespace", async () => {
      class Emitter extends CodeTypeEmitter {
        namespaceContext(namespace: Namespace): Context {
          return { inNamespace: true };
        }

        namespace(namespace: Namespace): EmitterOutput<string> {
          assert.deepStrictEqual(this.emitter.getContext(), {
            inNamespace: true,
          });

          return super.namespace(namespace);
        }
      }

      await emitCadl(Emitter, `namespace Foo {  }`);
    });

    it("should set context for everything inside the namespace, multiple namespaces", async () => {
      class Emitter extends CodeTypeEmitter {
        namespaceContext(namespace: Namespace): Context {
          return { inNamespace: namespace.name };
        }

        namespace(namespace: Namespace): EmitterOutput<string> {
          assert.deepStrictEqual(this.emitter.getContext(), {
            inNamespace: namespace.name,
          });

          return super.namespace(namespace);
        }
      }

      await emitCadl(Emitter, `namespace Foo {  } namespace Bar { }`, {
        namespaceContext: 2,
        namespace: 2,
      });
    });

    it("should set context for everything inside the namespace, nested namespaces", async () => {
      class Emitter extends CodeTypeEmitter {
        namespaceContext(namespace: Namespace): Context {
          const newState: Record<string, boolean> = {};
          if (namespace.name === "Foo") {
            newState.foo = true;
          } else {
            newState.bar = true;
          }

          return newState;
        }

        namespace(namespace: Namespace): EmitterOutput<string> {
          const expectedContext: Record<string, boolean> = { foo: true };

          if (namespace.name === "Bar") {
            expectedContext.bar = true;
          }

          assert.deepStrictEqual(
            this.emitter.getContext(),
            expectedContext,
            "context for namespace " + namespace.name
          );

          return super.namespace(namespace);
        }
      }

      await emitCadl(Emitter, `namespace Foo { namespace Bar { } }`, {
        namespaceContext: 2,
        namespace: 2,
      });
    });
  });

  describe("model context", () => {
    it("sets model context for models and properties", async () => {
      class Emitter extends CodeTypeEmitter {
        modelDeclarationContext(model: Model, name: string): Context {
          return {
            inModel: true,
          };
        }
        modelDeclaration(model: Model, name: string): EmitterOutput<string> {
          assert.deepStrictEqual(this.emitter.getContext(), {
            inModel: true,
          });
          return super.modelDeclaration(model, name);
        }

        modelPropertyLiteral(property: ModelProperty): EmitterOutput<string> {
          assert.deepStrictEqual(this.emitter.getContext(), {
            inModel: true,
          });
          return super.modelPropertyLiteral(property);
        }
      }

      await emitCadl(
        Emitter,
        `model Foo {
        prop: string;
      }`
      );
    });

    it("sets model context for nested model literals", async () => {
      class Emitter extends CodeTypeEmitter {
        modelDeclarationContext(model: Model, name: string): Context {
          return {
            inModel: true,
          };
        }

        modelLiteral(model: Model): EmitterOutput<string> {
          assert.deepStrictEqual(this.emitter.getContext(), {
            inModel: true,
          });

          return super.modelLiteral(model);
        }
      }

      await emitCadl(
        Emitter,
        `model Foo {
        prop: {
          nested: true
        };
      }`
      );
    });
  });

  describe("references", () => {
    it("namespace context is preserved for models in that namespace even with references", async () => {
      class TestEmitter extends CodeTypeEmitter {
        namespaceContext(namespace: Namespace): Context {
          return {
            inANamespace: namespace.name === "A",
          };
        }

        modelDeclaration(model: Model, name: string): EmitterOutput<string> {
          const context = this.emitter.getContext();
          if (name === "Foo") {
            assert(context.inANamespace);
          } else {
            assert(!context.inANamespace);
          }

          return super.modelDeclaration(model, name);
        }
      }

      await emitCadl(
        TestEmitter,
        `
        model Bar { prop: A.Foo };
        namespace A {
          model Foo { prop: string };
        }
      `,
        {
          namespaceContext: 2,
          modelDeclaration: 2,
        }
      );
    });
  });

  describe("reference context", () => {
    it("propagates reference context", async () => {
      const seenContexts: Set<boolean> = new Set();

      class TestEmitter extends CodeTypeEmitter {
        namespaceReferenceContext(namespace: Namespace): Context {
          if (namespace.name === "Foo") {
            return { refFromNs: true };
          }
          return {};
        }

        modelDeclaration(model: Model, name: string): EmitterOutput<string> {
          const context = this.emitter.getContext();
          if (model.name === "N") {
            seenContexts.add(context.refFromNs ?? false);
          }
          return super.modelDeclaration(model, name);
        }
      }

      await emitCadl(
        TestEmitter,
        `
        namespace Foo {
          model M { x: Bar.N }
        }
        namespace Bar {
          model N {}
        }
      `,
        {
          namespaceReferenceContext: 2,
          modelDeclaration: 3,
        }
      );

      assert(seenContexts.has(true), "N has ref context");
      assert(seenContexts.has(false), "N doesn't ref context also");
    });

    it("doesn't emit model multiple times when reference context is the same", async () => {
      class TestEmitter extends CodeTypeEmitter {
        modelDeclarationReferenceContext(model: Model): Context {
          if (model.name === "Qux") {
            return {};
          }
          return { ref: true };
        }

        modelDeclaration(model: Model, name: string): EmitterOutput<string> {
          return super.modelDeclaration(model, name);
        }
      }

      await emitCadl(
        TestEmitter,
        `
        model Foo { x: Qux }
        model Bar { x: Qux }
        model Qux { }
      `,
        {
          modelDeclarationReferenceContext: 4,
          modelDeclaration: 4,
        }
      );
    });
  });
});
