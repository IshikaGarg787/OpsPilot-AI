const Module = require('node:module');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

// Rollup's official WASM parser keeps the build usable on Windows machines
// where application-control policy blocks native .node dependencies.
const originalLoad = Module._load;
const rollupNative = path.resolve(process.cwd(), 'node_modules/rollup/dist/native.js');
const wasmNative = path.resolve(process.cwd(), 'node_modules/@rollup/wasm-node/dist/native.js');
Module._load = function patchedLoad(request, parent, isMain) {
  let resolved;
  try {
    resolved = Module._resolveFilename(request, parent, isMain);
  } catch {
    resolved = request;
  }
  if (resolved === rollupNative) return originalLoad(wasmNative, parent, isMain);
  return originalLoad(request, parent, isMain);
};

const viteBin = path.resolve(path.dirname(require.resolve('vite')), '../../bin/vite.js');
process.argv = [process.argv[0], viteBin, 'build'];
import(pathToFileURL(viteBin).href).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
