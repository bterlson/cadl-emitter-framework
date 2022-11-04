import { CadlTestLibrary, createTestHost } from "@cadl-lang/compiler/testing";
import { resolvePath } from "@cadl-lang/compiler";
import { fileURLToPath } from "url";

export const lib: CadlTestLibrary = {
  name: "cadl-ts-interface-emitter",
  packageRoot: resolvePath(fileURLToPath(import.meta.url), "../../../"),
  files: [
    { realDir: "", pattern: "package.json", virtualPath: "./node_modules/cadl-ts-interface-emitter" },
    {
      realDir: "dist/src",
      pattern: "*.js",
      virtualPath: "./node_modules/cadl-ts-interface-emitter/dist/src",
    },
  ],
};

export async function emitCadlFile(contents: string) {
  const host = await createTestHost();
  await host.addCadlLibrary(lib);
  await host.addCadlFile("main.cadl", contents);
  await host.compile("main.cadl", {
    outputDir: "cadl-output",
    emitters: {'cadl-ts-interface-emitter': true }
  });
}
export async function createHost() {
  const host = await createTestHost();
  
}

export async function getHostForCadlFile(contents: string, decorators?: Record<string, any>) {
  const host = await createTestHost();
  if (decorators) {
    await host.addJsFile("dec.js", decorators);
    contents = `import "./dec.js";\n` + contents;
  }
  await host.addCadlFile("main.cadl", contents);
  await host.compile("main.cadl", {
    outputDir: "cadl-output",
  });
  return host;
}