const requiredVars = ['PUMBLE_ADDON_MANIFEST_PATH'] as const;

export interface AppConfig {
  port: number;
  dbPath: string;
  manifestPath: string;
  tokenStorePath: string;
  logLevel: string;
  signingSecret: string | undefined;
  retentionDays: number;
}

function env(key: string): string | undefined {
  return process.env[key];
}

function getEnvErrors(): string[] {
  const errors: string[] = [];

  // PORT validation
  const portRaw = env('PORT');
  if (portRaw !== undefined) {
    const port = parseInt(portRaw, 10);
    if (isNaN(port) || port < 1 || port > 65535) {
      errors.push(`PORT must be an integer between 1 and 65535 (got "${portRaw}")`);
    }
  }

  // Required vars
  for (const key of requiredVars) {
    if (!env(key)) {
      errors.push(`Missing required environment variable: ${key}`);
    }
  }

  return errors;
}

export function loadConfig(): AppConfig {
  const errors = getEnvErrors();
  if (errors.length > 0) {
    const msg = `Configuration errors:\n  - ${errors.join('\n  - ')}`;
    throw new Error(msg);
  }

  return {
    port: parseInt(env('PORT') || '5000', 10),
    dbPath: env('DB_PATH') || './standup.db',
    manifestPath: env('PUMBLE_ADDON_MANIFEST_PATH') || './manifest.json',
    tokenStorePath: env('TOKEN_STORE_PATH') || './tokens.json',
    logLevel: env('LOG_LEVEL') || 'info',
    signingSecret: env('SIGNING_SECRET'),
    retentionDays: parseInt(env('RETENTION_DAYS') || '90', 10),
  };
}

let configInstance: AppConfig | null = null;

export function getConfig(): AppConfig {
  if (!configInstance) {
    configInstance = loadConfig();
  }
  return configInstance;
}
