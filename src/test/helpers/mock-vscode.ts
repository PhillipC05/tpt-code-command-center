// Registers a minimal vscode stub so pure-function tests can import modules
// that transitively require vscode without needing the VS Code runtime.
// Import this file FIRST before any module with a vscode dependency.

// eslint-disable-next-line @typescript-eslint/no-var-requires
const Module = require('module') as { _load: (...a: unknown[]) => unknown };
const original = Module._load;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
Module._load = function (...args: any[]) {
  const request: string = args[0];
  const rest = args.slice(1);
  if (request === 'vscode') {
    return {
      workspace: {
        getConfiguration: () => ({
          get: (_key: string, defaultValue: unknown) => defaultValue,
        }),
        workspaceFolders: undefined,
      },
      window: {
        createOutputChannel: () => ({
          appendLine: () => undefined,
          show: () => undefined,
        }),
      },
      commands: {
        executeCommand: () => Promise.resolve(),
      },
      ConfigurationTarget: { Workspace: 2, Global: 1 },
    };
  }
  return original.call(this, ...[request, ...rest]);
};
