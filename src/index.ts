import { AssetEmitter, EmitContext, EmittedSourceFile } from "./framework.js";
import { Program, getIntrinsicModelName, Model, EmitOptionsFor } from "@cadl-lang/compiler";
import { Lib } from "./lib.js";
import { join } from "path";


export async function $onEmit(p: Program, options: EmitOptionsFor<Lib>) {
  const outputDir = p.compilerOptions.outputDir!;
  await p.host.writeFile(join(outputDir, "test.ts"), "hi"); 
}

const instrinsicNameToTSType = new Map<string, string>([
  ["string", "string"],
  ["int32", "number"],
  ["int16", "number"],
  ["float16", "number"],
  ["float32", "number"],
  ["int64", "bigint"],
  ["boolean", "boolean"],
]);

export function createTSInterfaceEmitter(program: Program, context: EmitContext) {
  const emitter: AssetEmitter = context.createAssetEmitter(context.AssetTag.language("typescript"));
  const outputFile = emitter.createSourceFile("data-store.ts");
  const globalScope = outputFile.globalScope;
  emitter.addTypeEmitter({
    Model(m) {
      const intrinsicName = getIntrinsicModelName(program, m);
      if (intrinsicName) {
        if (!instrinsicNameToTSType.has(intrinsicName)) {
          throw new Error("Unknown intrinsic type " + intrinsicName);
        }
        
        return {
          code: "",
          scope: outputFile.globalScope,
          name: instrinsicNameToTSType.get(intrinsicName)!,
          type: m
        }
      }
  
      const props: string[] = [];
  
      for (const prop of m.properties.values()) {
        const name = prop.name === "_" ? "statusCode" : prop.name;
        props.push(
          `${name}${prop.optional ? "?" : ""}: ${emitter.emitTypeReference(prop.type, globalScope)}`
        );
      }
  
      const name = getModelDeclarationName(m);
  
      const code = `interface ${name} {
        ${props.join(",")}
      }`;

      return {
        code,
        name,
        scope: globalScope,
        type: m
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

      return sourceFile;
    },

    reference(decl) {
      return decl.name;
    }
  });



  function getModelDeclarationName(type: Model): string {
    if (
      type.templateArguments === undefined ||
      type.templateArguments.length === 0
    ) {
      return type.name;
    }

    // todo: this probably needs to be a lot more robust
    const parameterNames = type.templateArguments.map((t) => {
      switch (t.kind) {
        case "Model":
          return getModelDeclarationName(t);
        default:
          throw new Error(
            "Can't get a name for non-model type used to instantiate a model template"
          );
      }
    });

    return type.name + parameterNames.join("");
  }

  return emitter;
}
