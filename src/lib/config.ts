export type Config = {
  dataDir: string;
  maxUploadBytes: number;
  jobTtlMs: number;
  ocrConcurrency: number;
};

type Env = Record<string, string | undefined>;

function positive(value: string | undefined, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export function getConfig(env: Env = process.env): Config {
  return {
    dataDir: env.DATA_DIR || './data',
    maxUploadBytes: positive(env.MAX_UPLOAD_MB, 500) * 1024 * 1024,
    jobTtlMs: positive(env.JOB_TTL_HOURS, 24) * 3600_000,
    ocrConcurrency: Math.floor(positive(env.OCR_CONCURRENCY, 2)),
  };
}
