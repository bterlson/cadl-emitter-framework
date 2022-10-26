import { AssetEmitter, createEmitterContext, EmittedSourceFile, Scope, TypeEmitter } from "../src/framework.js";
import { createTSInterfaceEmitter } from "../src/index.js";
import test from "ava";
import {emitCadlFile, getHostForCadlFile} from "./host.js";
import { getIntrinsicModelName, Model, navigateProgram, getDoc } from "@cadl-lang/compiler";
import prettier from "prettier";

const instrinsicNameToTSType = new Map<string, string>([
  ["string", "string"],
  ["int32", "number"],
  ["int16", "number"],
  ["float16", "number"],
  ["float32", "number"],
  ["int64", "bigint"],
  ["boolean", "boolean"],
]);

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
    Model(m, emitter) {
      const intrinsicName = getIntrinsicModelName(program, m);
      if (intrinsicName) {
        if (!instrinsicNameToTSType.has(intrinsicName)) {
          throw new Error("Unknown intrinsic type " + intrinsicName);
        }
        
        const code = instrinsicNameToTSType.get(intrinsicName)!;
        return emitter.createLiteral(m, code);
      }

      const props: string[] = [];
    
      for (const prop of m.properties.values()) {
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
        props.push(
          `${docString}${name}${prop.optional ? "?" : ""}: ${
            emitter.getTypeReference(prop.type)
          }`
        );
      }

      const name = emitter.getDeclarationName(m);

      if (!name) {
        const code = `{
          ${props.join(",")}
        }`;

        return emitter.createLiteral(m, code);
      } else if (m.name === "Array") {
        // assumption: it seems like Array can always an array expression?
        // Otherwise needed to be model is?
        // assumption: array literals don't have regular properties?
        const code = `${emitter.getTypeReference(m.indexer!.value!)}[]`
        return emitter.createLiteral(m, code);
      }

      let extendsClause = "";
      if (m.indexer && m.indexer.key!.name === "integer") {
        extendsClause = `extends Array<${emitter.getTypeReference(m.indexer!.value!)}>`
      } else if (m.baseModel) {
        extendsClause = `extends ${emitter.getTypeReference(m.baseModel)}`
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
        ${props.join(",")}
      }`;

      return emitter.createDeclaration(m, name, code);
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
      emitter.emit(m)
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
  `);
  const program = host.program;
  const context = createEmitterContext(host.program);

  // start your code
  // if another emitter emits the same type with the same tag, it will not be emitted again.
  // if another emitter requests a reference to a type with the same tag, it will get a reference
  // to the previously emitted type
  const emitter = context.createAssetEmitter(context.AssetTag.language("typescript"));

  emitter.addTypeEmitter({
    Model(m, emitter) {
      // step 1: handle cadl intrinsics by mapping to the corresponding
      // typescript type
      const intrinsicName = getIntrinsicModelName(program, m);
      if (intrinsicName) {
        if (!instrinsicNameToTSType.has(intrinsicName)) {
          throw new Error("Unknown intrinsic type " + intrinsicName);
        }
        
        const code = instrinsicNameToTSType.get(intrinsicName)!;
        return emitter.createLiteral(m, code);
      }

      // step 2: see if we're emitting a declaration or a literal.
      // * If the model has no name, emit a literal.
      // * If the model is an instantiation of Array, emit a literal.
      // * Otherwise, emit a declaration
      //
      // This means that template instantiations, while generally not explicitly
      // declared in the cadl, get a declaration. This makes sense as templates
      // are declaration templates and so every instantiation gets a declaration.
      const name = getModelDeclarationName(m);

      if (!name) {
        // it might be tempting to create the code for props early, but we actually
        // can't do that because the source scope of any references in the properties
        // is different depending on if we're ultimately making a new declaration or
        // we're emitting a literal that will presumably be used in another declaration

        const code = `{
          ${emitProps()}
        }`;
        return emitter.createLiteral(m, code);
      } else if (m.name === "Array") {
        // assumption: it seems like Array is always an array expression?
        //   i.e. that if we have a generically named Array model it means
        //   we didn't give it a better name with `model is` and so we
        //   presumably found this type by walking into it from some container
        //   type that references it, and so we just need to emit a literal.
        // assumption: array literals don't have regular properties?
        const code = `${emitter.getTypeReference(m.indexer!.value!)}[]`;
        return emitter.createLiteral(m, code);
      }

      // We are emitting a declaration, so create a source file for it.
      const sourceFile = emitter.createSourceFile(`${name}.ts`);

      // Set the new scope, storing off the old scope to restore later.
      // We will have a scope to restore when in the process of emitting
      // a model we come across another model that needs a declaration.
      const oldScope = emitter.setScope(sourceFile.globalScope);

      let extendsClause = "";
      if (m.indexer && m.indexer.key!.name === "integer") {
        // special case for when we have a named declaration that is an array
        // e.g. `model Foo is Array<T>;`
        extendsClause = `extends Array<${emitter.getTypeReference(m.indexer!.value!)}>`
      } else if (m.baseModel) {
        // handle base model
        // assumption: there is no way that a named array will also have a base model?
        extendsClause = `extends ${emitter.getTypeReference(m.baseModel)}`
      }

      let code = '';

      let comment = getDoc(program, m);
      if (comment) {
        code += `
          /**
           * ${comment}
           */
        `
      }
      code += `interface ${name} ${extendsClause} {
        ${emitProps()}
      }`;

      const decl = emitter.createDeclaration(m, name, code);
      emitter.restoreScope(oldScope);
      return decl;

      function emitProps() {
        const props: string[] = [];
    
        for (const prop of m.properties.values()) {
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
          props.push(
            `${docString}${name}${prop.optional ? "?" : ""}: ${
              emitter.getTypeReference(prop.type)
            }`
          );
        }

        return props.join(",")
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

    reference(decl, sourceScope) {
      // a (mostly) broken implementation of finding the shortest FQI
      // this can likely be part of the framework, vending you just the target
      // type and the scope path to get there.
      if (sourceScope === decl.scope) {
        return decl.name;
      }
      
      const declChain = scopeChain(decl.scope).reverse();
      const sourceChain = scopeChain(sourceScope).reverse();
      let firstDifferentIndex = 0;

      while (true) {
  
        if (firstDifferentIndex >= declChain.length || firstDifferentIndex >= sourceChain.length) {
          break;
        }

        if (declChain[firstDifferentIndex] !== sourceChain[firstDifferentIndex]) {
          break;
        }
  
        firstDifferentIndex++;
      }

      for(let i =0; i < firstDifferentIndex; i++) {
        declChain.shift();
        sourceChain.shift();
      }
    
      const sourceSourceFile = sourceChain[0].sourceFile;
      const declSourceFile = declChain[0].sourceFile;

      sourceSourceFile.imports.set(`./${declSourceFile.path.replace(".js", ".ts")}`, [decl.name]);
      return declChain.map(s => s.name).join(".") + decl.name;
    }
  })


  navigateProgram(program, {
    model(m) {
      if (m.namespace?.name === "Cadl") { return }
      console.log("Visiting model", m.name);
      emitter.emit(m)
    }
  });

  await emitter.writeOutput();

  console.log(host.fs);
});

function scopeChain(scope: Scope) {
  const chain = [scope];

  while (scope.parentScope) {
    chain.push(scope.parentScope);
    scope = scope.parentScope;
  }
  
  return chain;
}