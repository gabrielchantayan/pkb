export interface Config {
  port: number;
  database_url: string;
  node_env: string;
  api_key: string | null;
  jwt_secret: string | null;
  gemini_api_key: string | null;
  storage_type: 'local' | 's3';
  storage_path: string;
  log_level: 'debug' | 'info' | 'warn' | 'error';
}

function get_env(key: string, default_value?: string): string {
  const value = process.env[key];
  if (value === undefined) {
    if (default_value !== undefined) {
      return default_value;
    }
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

export function load_config(): Config {
  return {
    port: parseInt(get_env('PORT', '4000'), 10),
    database_url: get_env('DATABASE_URL', 'postgres://pkb:pkb@localhost:5432/pkb'),
    node_env: get_env('NODE_ENV', 'development'),
    api_key: process.env.API_KEY || null,
    jwt_secret: process.env.JWT_SECRET || null,
    gemini_api_key: process.env.GEMINI_API_KEY || null,
    storage_type: (process.env.STORAGE_TYPE as 'local' | 's3') || 'local',
    storage_path: get_env('STORAGE_PATH', './data/attachments'),
    log_level: (process.env.LOG_LEVEL as Config['log_level']) || 'info',
  };
}

export const config = load_config();
