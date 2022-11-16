import {
  BooleanLiteral,
  getDoc,
  Model,
  ModelProperty,
  NumericLiteral,
  Operation,
  StringLiteral,
  Type,
  Interface,
  Enum,
  EnumMember,
  Union,
  UnionVariant,
} from "@cadl-lang/compiler";
import prettier from "prettier";
import {
  EmitEntity,
  EmittedSourceFile,
  SourceFile,
  Declaration,
  Scope,
  SourceFileScope,
  EmitEntityOrString,
} from "./types.js";

import { CodeBuilder, code } from "./code-builder.js";
import { TypeEmitter } from "./type-emitter.js";

export function isArrayType(m: Model) {
  return m.name === "Array";
}

export const intrinsicNameToTSType = new Map<string, string>([
  ["string", "string"],
  ["int32", "number"],
  ["int16", "number"],
  ["float16", "number"],
  ["float32", "number"],
  ["int64", "bigint"],
  ["boolean", "boolean"],
  ["null", "null"],
]);

export class TypeScriptInterfaceEmitter extends TypeEmitter {
  // type literals
  booleanLiteral(boolean: BooleanLiteral): EmitEntityOrString {
    return JSON.stringify(boolean.value);
  }

  numericLiteral(number: NumericLiteral): EmitEntityOrString {
    return JSON.stringify(number.value);
  }

  stringLiteral(string: StringLiteral): EmitEntityOrString {
    return JSON.stringify(string.value);
  }

  modelScalar(model: Model, scalarName: string): EmitEntityOrString {
    if (!intrinsicNameToTSType.has(scalarName)) {
      throw new Error("Unknown scalar type " + scalarName);
    }

    const code = intrinsicNameToTSType.get(scalarName)!;
    return this.emitter.result.literal(code);
  }

  modelLiteral(model: Model): EmitEntityOrString {
    if (isArrayType(model)) {
      return this.emitter.result.literal(
        code`${this.emitter.emitTypeReference(model.indexer!.value!)}[]`
      );
    }

    return this.emitter.result.literal(
      code`{ ${this.emitter.emitModelProperties(model)}}`
    );
  }

  modelDeclaration(model: Model, name: string): EmitEntityOrString {
    let extendsClause;
    if (model.indexer && model.indexer.key!.name === "integer") {
      extendsClause = code`extends Array<${this.emitter.emitTypeReference(
        model.indexer!.value!
      )}>`;
    } else if (model.baseModel) {
      extendsClause = code`extends ${this.emitter.emitTypeReference(
        model.baseModel
      )}`;
    } else {
      extendsClause = "";
    }

    let comment = getDoc(this.emitter.getProgram(), model);
    let commentCode = "";

    if (comment) {
      commentCode = `
        /**
         * ${comment}
         */`;
    }

    return this.emitter.result.declaration(
      name,
      code`${commentCode}\nexport interface ${name} ${extendsClause} {
        ${this.emitter.emitModelProperties(model)}
      }`
    );
  }

  modelInstantiation(model: Model, name: string): EmitEntityOrString {
    return this.modelDeclaration(model, name);
  }

  modelPropertyLiteral(property: ModelProperty): EmitEntityOrString {
    const name = property.name === "_" ? "statusCode" : property.name;
    const doc = getDoc(this.emitter.getProgram(), property);
    let docString = "";

    if (doc) {
      docString = `
      /**
       * ${doc}
       */
      `;
    }

    return this.emitter.result.literal(
      code`${docString}${name}${
        property.optional ? "?" : ""
      }: ${this.emitter.emitTypeReference(property.type)}`
    );
  }

  operationDeclaration(operation: Operation, name: string): EmitEntityOrString {
    return this.emitter.result.declaration(
      name,
      code`interface ${name} {
      ${this.#operationSignature(operation)}
    }`
    );
  }

  operationParameters(
    operation: Operation,
    parameters: Model
  ): EmitEntityOrString {
    const cb = new CodeBuilder();
    for (const prop of parameters.properties.values()) {
      cb.push(
        code`${prop.name}${
          prop.optional ? "?" : ""
        }: ${this.emitter.emitTypeReference(prop.type)},`
      );
    }
    return cb;
  }

  #operationSignature(operation: Operation) {
    return code`(${this.emitter.emitOperationParameters(
      operation
    )}): ${this.emitter.emitOperationReturnType(operation)}`;
  }

  operationReturnType(
    operation: Operation,
    returnType: Type
  ): EmitEntityOrString {
    return this.emitter.emitTypeReference(returnType);
  }

  interfaceDeclaration(iface: Interface, name: string): EmitEntityOrString {
    return this.emitter.result.declaration(
      name,
      code`
      export interface ${name} {
        ${this.emitter.emitInterfaceOperations(iface)}
      }
    `
    );
  }

  interfaceOperationDeclaration(
    operation: Operation,
    name: string
  ): EmitEntityOrString {
    return code`${name}${this.#operationSignature(operation)}`;
  }

  enumDeclaration(en: Enum, name: string): EmitEntityOrString {
    return this.emitter.result.declaration(
      name,
      code`export enum ${name} {
        ${this.emitter.emitEnumMembers(en)}
      }`
    );
  }

  enumMember(member: EnumMember): EmitEntityOrString {
    // should we just fill in value for you?
    const value = !member.value ? member.name : member.value;

    return `
      ${member.name} = ${JSON.stringify(value)}
    `;
  }

  unionDeclaration(union: Union, name: string): EmitEntityOrString {
    return this.emitter.result.declaration(
      name,
      code`export type ${name} = ${this.emitter.emitUnionVariants(union)}`
    );
  }

  unionInstantiation(union: Union, name: string): EmitEntityOrString {
    return this.unionDeclaration(union, name);
  }

  unionLiteral(union: Union) {
    return this.emitter.emitUnionVariants(union);
  }

  unionVariants(union: Union): EmitEntityOrString {
    const builder = new CodeBuilder();
    let i = 0;
    for (const variant of union.variants.values()) {
      i++;
      builder.push(
        code`${this.emitter.emitType(variant)}${
          i < union.variants.size ? "|" : ""
        }`
      );
    }
    return this.emitter.result.rawCode(builder.reduce());
  }

  unionVariant(variant: UnionVariant): EmitEntityOrString {
    return this.emitter.emitTypeReference(variant.type);
  }

  reference(
    targetDeclaration: Declaration,
    pathUp: Scope[],
    pathDown: Scope[],
    commonScope: Scope | null
  ) {
    if (!commonScope) {
      const sourceSf = (pathUp[0] as SourceFileScope).sourceFile;
      const targetSf = (pathDown[0] as SourceFileScope).sourceFile;
      console.log(sourceSf, targetSf);
      sourceSf.imports.set(`./${targetSf.path.replace(".js", ".ts")}`, [
        targetDeclaration.name,
      ]);
    }

    return super.reference(targetDeclaration, pathUp, pathDown, commonScope);
  }

  sourceFile(sourceFile: SourceFile): EmittedSourceFile {
    const emittedSourceFile: EmittedSourceFile = {
      path: sourceFile.path,
      contents: "",
    };

    for (const [importPath, typeNames] of sourceFile.imports) {
      emittedSourceFile.contents += `import {${typeNames.join(
        ","
      )}} from "${importPath}";\n`;
    }

    for (const decl of sourceFile.globalScope.declarations) {
      emittedSourceFile.contents += decl.code + "\n";
    }

    emittedSourceFile.contents = prettier.format(emittedSourceFile.contents, {
      parser: "typescript",
    });
    return emittedSourceFile;
  }
}
