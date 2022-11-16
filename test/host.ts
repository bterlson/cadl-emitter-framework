import { CadlTestLibrary, createTestHost } from "@cadl-lang/compiler/testing";
import { navigateProgram, resolvePath } from "@cadl-lang/compiler";
import { fileURLToPath } from "url";
import {
  AssetEmitter,
  createEmitterContext,
  EmitContext,
  TypeEmitter,
} from "../src/framework.js";
import { SinonSpy, spy,  } from "sinon";
import assert from "assert";

export const lib: CadlTestLibrary = {
  name: "cadl-ts-interface-emitter",
  packageRoot: resolvePath(fileURLToPath(import.meta.url), "../../../"),
  files: [
    {
      realDir: "",
      pattern: "package.json",
      virtualPath: "./node_modules/cadl-ts-interface-emitter",
    },
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
    emitters: { "cadl-ts-interface-emitter": true },
  });
}

export async function getHostForCadlFile(
  contents: string,
  decorators?: Record<string, any>
) {
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

export async function createEmitContext(code: string) {
  const host = await getHostForCadlFile(code);
  return createEmitterContext(host.program);
}

export function emitGlobalNamespace(
  context: EmitContext,
  typeEmitter: typeof TypeEmitter
) {
  const emitter = context.createAssetEmitter(typeEmitter, {});
  emitter.emitType(emitter.getProgram().getGlobalNamespaceType());
}

export async function emitCadl(Emitter: typeof TypeEmitter, code: string, callCounts: Partial<Record<keyof TypeEmitter, number>> = {}) {
  const context = await createEmitContext(code);
  const spies = emitterSpies(Emitter);
  const emitter = context.createAssetEmitter(Emitter, {});
  emitter.emitProgram();
  await emitter.writeOutput();
  assertSpiesCalled(spies, callCounts);
  return emitter;
}

type EmitterSpies = Record<string, SinonSpy>;
function emitterSpies(emitter: typeof TypeEmitter) {
  const spies: EmitterSpies = {};
  const methods = Object.getOwnPropertyNames(emitter.prototype);
  for (const key of methods) {
    if (key === "constructor") continue;
    if ((emitter.prototype as any)[key].restore) {
      // assume this whole thing is already spied.
      return spies;
    }
    if (typeof (emitter.prototype as any)[key] !== "function") continue;
    spies[key] = spy(emitter.prototype, key as any);
  }

  return spies;
}

function assertSpiesCalled(spies: EmitterSpies, callCounts: Partial<Record<keyof TypeEmitter, number>>) {
  for (const [key, spy] of Object.entries(spies)) {
    const expectedCount = (callCounts as any)[key] ?? 1;
    assert.equal(spy.callCount, expectedCount, `Emitter method ${key} should called ${expectedCount} time(s), was called ${spy.callCount} time(s)`);
  }
}
