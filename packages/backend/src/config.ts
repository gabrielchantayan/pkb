export interface Config {
  port: number;
  database_url: string;
  node_env: string;
  api_key: string;
  jwt_secret: string;
  gemini_api_key: string;
  storage_type: 'local' | 's3';
  storage_path: string;
  log_level: 'debug' | 'info' | 'warn' | 'error';
  frf_cron_interval: string;
  frf_batch_size: number;
  frf_batch_overlap: number;
  frf_context_messages: number;
  frf_confidence_threshold: number;
  frf_dedup_similarity: number;
  frf_followup_cutoff_days: number;
  frf_batch_delay_ms: number;
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
    database_url: get_env('DATABASE_URL'),
    node_env: get_env('NODE_ENV', 'development'),
    api_key: get_env('API_KEY'),
    jwt_secret: get_env('JWT_SECRET'),
    gemini_api_key: get_env('GEMINI_API_KEY'),
    storage_type: (process.env.STORAGE_TYPE as 'local' | 's3') || 'local',
    storage_path: get_env('STORAGE_PATH', './data/attachments'),
    log_level: (process.env.LOG_LEVEL as Config['log_level']) || 'info',
    frf_cron_interval: get_env('FRF_CRON_INTERVAL', '*/30 * * * *'),
    frf_batch_size: parseInt(get_env('FRF_BATCH_SIZE', '15'), 10),
    frf_batch_overlap: parseInt(get_env('FRF_BATCH_OVERLAP', '2'), 10),
    frf_context_messages: parseInt(get_env('FRF_CONTEXT_MESSAGES', '5'), 10),
    frf_confidence_threshold: parseFloat(get_env('FRF_CONFIDENCE_THRESHOLD', '0.75')),
    frf_dedup_similarity: parseFloat(get_env('FRF_DEDUP_SIMILARITY', '0.80')),
    frf_followup_cutoff_days: parseInt(get_env('FRF_FOLLOWUP_CUTOFF_DAYS', '90'), 10),
    frf_batch_delay_ms: parseInt(get_env('FRF_BATCH_DELAY_MS', '300'), 10),
  };
}

export const config = load_config();
