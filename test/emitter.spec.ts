import { AssetEmitter, createEmitterContext, EmittedSourceFile, Scope, TypeEmitter } from "../src/framework.js";
import { createTSInterfaceEmitter } from "../src/index.js";
import test from "ava";
import {emitCadlFile, getHostForCadlFile} from "./host.js";
import { getIntrinsicModelName, Model, navigateProgram, getDoc } from "@cadl-lang/compiler";
import prettier from "prettier";

const intrinsicNameToTSType = new Map<string, string>([
  ["string", "string"],
  ["int32", "number"],
  ["int16", "number"],
  ["float16", "number"],
  ["float32", "number"],
  ["int64", "bigint"],
  ["boolean", "boolean"],
]);

function isArray(m: Model) {
  return m.name === "Array";
}

test('emits models to a single file', async (t) => {
  const host = await getHostForCadlFile(`
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
  `);
  const program = host.program;
  const context = createEmitterContext(host.program);

  // start your code
  // if another emitter emits the same type with the same tag, it will not be emitted again.
  // if another emitter requests a reference to a type with the same tag, it will get a reference
  // to the previously emitted type
  const emitter = context.createAssetEmitter(context.AssetTag.language("typescript"));
  const outputFile = emitter.createSourceFile("output.ts");
  emitter.pushScope(outputFile.globalScope);

  emitter.addTypeEmitter({
    Model: {
      scalar(m, name) {
        if (!intrinsicNameToTSType.has(name)) {
          throw new Error("Unknown scalar type " + name);
        }
        
        const code = intrinsicNameToTSType.get(name)!;
        return emitter.createLiteral(m, code);
      },

      literal(m) {
        if (isArray(m)) {
          return emitter.createLiteral(m, `${emitter.emitTypeReference(m.indexer!.value!)}[]`);
        }

        return emitter.createLiteral(m, `{ ${emitter.emitModelProperties(m, m.properties) }}`);
      },

      declaration(m, name) {
        let extendsClause = "";
        if (m.indexer && m.indexer.key!.name === "integer") {
          extendsClause = `extends Array<${emitter.emitTypeReference(m.indexer!.value!)}>`
        } else if (m.baseModel) {
          extendsClause = `extends ${emitter.emitTypeReference(m.baseModel)}`
        }
  
        let comment = getDoc(program, m);
        let code = '';
  
        if (comment) {
          code += `
            /**
             * ${comment}
             */
          `
        }
        code += `interface ${name} ${extendsClause} {
          ${emitter.emitModelProperties(m, m.properties)}
        }`;
  
        return emitter.createDeclaration(m, name, code);
      },

      properties(m, properties) {
        return Array.from(properties.values()).map(p => emitter.emitModelProperty(p)).join(",");
      }
    },
    ModelProperty: {
      literal(prop) {
        const name = prop.name === "_" ? "statusCode" : prop.name;
        const doc = getDoc(program, prop);
        let docString = '';
  
        if (doc) {
          docString = `
          /**
           * ${doc}
           */
          `
        }
        
        return emitter.createLiteral(prop, 
          `${docString}${name}${prop.optional ? "?" : ""}: ${
            emitter.emitTypeReference(prop.type)
          }`
        );
      },
      reference(prop) {
        return emitter.emitTypeReference(prop.type);
      }
    },
    sourceFile(s) {
      const sourceFile: EmittedSourceFile = {
        path: s.path,
        contents: ''
      }

      for (const decl of s.declarations) {
        sourceFile.contents += decl.code + "\n";
      }
      sourceFile.contents = prettier.format(sourceFile.contents, { parser: "typescript" })
      return sourceFile;
    },

    reference(decl, scope) {
      return decl.name;
    }
  })

  navigateProgram(program, {
    model(m) {
      if (m.namespace?.name === "Cadl") { return }
      emitter.emitType(m)
    }
  });

  await emitter.writeOutput();

  console.log(host.fs.get("Z:/test/output.ts"));
});


test.only('emits models to one model per file', async (t) => {
  const host = await getHostForCadlFile(`
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
  `);
  const program = host.program;
  const context = createEmitterContext(host.program);

  // start your code
  // if another emitter emits the same type with the same tag, it will not be emitted again.
  // if another emitter requests a reference to a type with the same tag, it will get a reference
  // to the previously emitted type
  const emitter = context.createAssetEmitter(context.AssetTag.language("typescript"));

  emitter.addTypeEmitter({
    Model: {
      scalar(m, name) {
        if (!intrinsicNameToTSType.has(name)) {
          throw new Error("Unknown scalar type " + name);
        }
        
        const code = intrinsicNameToTSType.get(name)!;
        return emitter.createLiteral(m, code);
      },

      literal(m) {
        if (isArray(m)) {
          return emitter.createLiteral(m, `${emitter.emitTypeReference(m.indexer!.value!)}[]`);
        }

        return emitter.createLiteral(m, `{ ${emitter.emitModelProperties(m, m.properties) }}`);
      },

      declaration(m, name) {
        // change 1 - create an output file per declaration
        const outputFile = emitter.createSourceFile(`${name}.ts`);
        const oldScope = emitter.setScope(outputFile.globalScope);
      
        let extendsClause = "";
        if (m.indexer && m.indexer.key!.name === "integer") {
          extendsClause = `extends Array<${emitter.emitTypeReference(m.indexer!.value!)}>`
        } else if (m.baseModel) {
          extendsClause = `extends ${emitter.emitTypeReference(m.baseModel)}`
        }
  
        let comment = getDoc(program, m);
        let code = '';
  
        if (comment) {
          code += `
            /**
             * ${comment}
             */
          `
        }
        code += `export interface ${name} ${extendsClause} {
          ${emitter.emitModelProperties(m, m.properties)}
        }`;
        const decl = emitter.createDeclaration(m, name, code);

        // change 2 - scope management
        emitter.restoreScope(oldScope);
        return decl;
      },

      properties(m, properties) {
        return Array.from(properties.values()).map(p => emitter.emitModelProperty(p)).join(",");
      }
    },
    ModelProperty: {
      literal(prop) {
        const name = prop.name === "_" ? "statusCode" : prop.name;
        const doc = getDoc(program, prop);
        let docString = '';
  
        if (doc) {
          docString = `
          /**
           * ${doc}
           */
          `
        }
        
        return emitter.createLiteral(prop, 
          `${docString}${name}${prop.optional ? "?" : ""}: ${
            emitter.emitTypeReference(prop.type)
          }`
        );
      },
      reference(prop) {
        return emitter.emitTypeReference(prop.type);
      }
    },
    sourceFile(s) {
      const sourceFile: EmittedSourceFile = {
        path: s.path,
        contents: ''
      }

      for (const [importPath, typeNames] of s.imports) {
        sourceFile.contents += `import {${typeNames.join(",")}} from "${importPath}";\n`;
      }

      for (const decl of s.declarations) {
        sourceFile.contents += decl.code + "\n";
      }
      sourceFile.contents = prettier.format(sourceFile.contents, { parser: "typescript" })
      return sourceFile;
    },

    reference(decl, scope) {
      // change 3 - import the file the type is defined in
      // todo: handle same-file refs
      scope.sourceFile.imports.set(`./${decl.scope.sourceFile.path.replace(".js", ".ts")}`, [decl.name]);
      return decl.name;
    }
  })

  navigateProgram(program, {
    model(m) {
      if (m.namespace?.name === "Cadl") { return }
      emitter.emitType(m)
    }
  });

  await emitter.writeOutput();

  console.log(host.fs);
});