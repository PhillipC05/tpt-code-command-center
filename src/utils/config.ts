import * as vscode from 'vscode';

export type UpstreamProvider = 'openrouter' | 'anthropic' | 'openai' | 'local' | 'custom';

export interface TptConfig {
  enabled: boolean;
  upstreamProvider: UpstreamProvider;
  openrouterApiKey: string;
  anthropicApiKey: string;
  openaiApiKey: string;
  localBaseUrl: string;
  customBaseUrl: string;
  customApiKey: string;
  vault: { enabled: boolean; customRegex: string[] };
  smartContext: { enabled: boolean; maxFileSize: number };
  tokenShield: { enabled: boolean; maxCacheSizeMB: number };
  memoryWeaver: { enabled: boolean; tokenThreshold: number; fallbackOrder: string[] };
  router: { enabled: boolean; rules: RouterRule[] };
  silentEdit: { enabled: boolean };
  forge: { autoUpdate: boolean };
  terminal: { verboseLogging: boolean };
}

export interface RouterRule {
  match: { maxTokens?: number; keywords?: string[]; extensions?: string[] };
  model: string;
  provider: string;
}

export function getConfig(): TptConfig {
  const c = vscode.workspace.getConfiguration('tpt');
  return {
    enabled: c.get<boolean>('enabled', true),
    upstreamProvider: c.get<UpstreamProvider>('upstreamProvider', 'openrouter'),
    openrouterApiKey: c.get<string>('openrouterApiKey', ''),
    anthropicApiKey: c.get<string>('anthropicApiKey', ''),
    openaiApiKey: c.get<string>('openaiApiKey', ''),
    localBaseUrl: c.get<string>('localBaseUrl', 'http://localhost:11434/v1'),
    customBaseUrl: c.get<string>('customBaseUrl', ''),
    customApiKey: c.get<string>('customApiKey', ''),
    vault: {
      enabled: c.get<boolean>('vault.enabled', true),
      customRegex: c.get<string[]>('vault.customRegex', []),
    },
    smartContext: {
      enabled: c.get<boolean>('smartContext.enabled', true),
      maxFileSize: c.get<number>('smartContext.maxFileSize', 512000),
    },
    tokenShield: {
      enabled: c.get<boolean>('tokenShield.enabled', true),
      maxCacheSizeMB: c.get<number>('tokenShield.maxCacheSizeMB', 256),
    },
    memoryWeaver: {
      enabled: c.get<boolean>('memoryWeaver.enabled', true),
      tokenThreshold: c.get<number>('memoryWeaver.tokenThreshold', 50000),
      fallbackOrder: c.get<string[]>('memoryWeaver.fallbackOrder', ['ollama', 'proxy', 'extractive']),
    },
    router: {
      enabled: c.get<boolean>('router.enabled', false),
      rules: c.get<RouterRule[]>('router.rules', []),
    },
    silentEdit: {
      enabled: c.get<boolean>('silentEdit.enabled', false),
    },
    forge: {
      autoUpdate: c.get<boolean>('forge.autoUpdate', true),
    },
    terminal: {
      verboseLogging: c.get<boolean>('terminal.verboseLogging', false),
    },
  };
}

export function resolveUpstreamUrl(config: TptConfig): { baseUrl: string; apiKey: string } {
  switch (config.upstreamProvider) {
    case 'anthropic':
      return { baseUrl: 'https://api.anthropic.com', apiKey: config.anthropicApiKey };
    case 'openai':
      return { baseUrl: 'https://api.openai.com/v1', apiKey: config.openaiApiKey };
    case 'local':
      return { baseUrl: config.localBaseUrl, apiKey: '' };
    case 'custom':
      return { baseUrl: config.customBaseUrl, apiKey: config.customApiKey };
    case 'openrouter':
    default:
      return { baseUrl: 'https://openrouter.ai/api/v1', apiKey: config.openrouterApiKey };
  }
}
