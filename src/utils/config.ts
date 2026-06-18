import * as vscode from 'vscode';

export type UpstreamProvider =
  | 'openrouter'
  | 'anthropic'
  | 'openai'
  | 'deepseek'
  | 'qwen'
  | 'kimi'
  | 'grok'
  | 'local'
  | 'custom';

export interface TptConfig {
  enabled: boolean;
  upstreamProvider: UpstreamProvider;
  openrouterApiKey: string;
  anthropicApiKey: string;
  openaiApiKey: string;
  deepseekApiKey: string;
  qwenApiKey: string;
  kimiApiKey: string;
  grokApiKey: string;
  localBaseUrl: string;
  customBaseUrl: string;
  customApiKey: string;
  vault: { enabled: boolean; customRegex: string[] };
  smartContext: { enabled: boolean; maxFileSize: number };
  tokenShield: { enabled: boolean; maxCacheSizeMB: number };
  memoryWeaver: {
    enabled: boolean;
    tokenThreshold: number;
    fallbackOrder: string[];
    anthropicSummaryModel: string;
    openaiSummaryModel: string;
    ollamaModel: string;
  };
  router: { enabled: boolean; rules: RouterRule[] };
  silentEdit: { enabled: boolean };
  forge: { autoUpdate: boolean; registryUrl: string };
  terminal: { verboseLogging: boolean };
  costBudget: { dailyLimitUsd: number };
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
    deepseekApiKey: c.get<string>('deepseekApiKey', ''),
    qwenApiKey: c.get<string>('qwenApiKey', ''),
    kimiApiKey: c.get<string>('kimiApiKey', ''),
    grokApiKey: c.get<string>('grokApiKey', ''),
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
      anthropicSummaryModel: c.get<string>('memoryWeaver.anthropicSummaryModel', 'claude-haiku-4-5-20251001'),
      openaiSummaryModel:    c.get<string>('memoryWeaver.openaiSummaryModel',    'gpt-4o-mini'),
      ollamaModel:           c.get<string>('memoryWeaver.ollamaModel',            'llama3'),
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
      registryUrl: c.get<string>('forge.registryUrl', ''),
    },
    terminal: {
      verboseLogging: c.get<boolean>('terminal.verboseLogging', false),
    },
    costBudget: {
      dailyLimitUsd: c.get<number>('costBudget.dailyLimitUsd', 0),
    },
  };
}

export function resolveUpstreamUrl(config: TptConfig): { baseUrl: string; apiKey: string } {
  switch (config.upstreamProvider) {
    case 'anthropic':
      return { baseUrl: 'https://api.anthropic.com', apiKey: config.anthropicApiKey };
    case 'openai':
      return { baseUrl: 'https://api.openai.com/v1', apiKey: config.openaiApiKey };
    case 'deepseek':
      return { baseUrl: 'https://api.deepseek.com/v1', apiKey: config.deepseekApiKey };
    case 'qwen':
      return { baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', apiKey: config.qwenApiKey };
    case 'kimi':
      return { baseUrl: 'https://api.moonshot.cn/v1', apiKey: config.kimiApiKey };
    case 'grok':
      return { baseUrl: 'https://api.x.ai/v1', apiKey: config.grokApiKey };
    case 'local':
      return { baseUrl: config.localBaseUrl, apiKey: '' };
    case 'custom':
      return { baseUrl: config.customBaseUrl, apiKey: config.customApiKey };
    case 'openrouter':
    default:
      return { baseUrl: 'https://openrouter.ai/api/v1', apiKey: config.openrouterApiKey };
  }
}
