interface Env {
  DB: D1Database;
  FILES: R2Bucket;
  APP_ENV: string;
  PUBLIC_BASE_URL?: string;
  R2_ACCOUNT_ID?: string;
  R2_ACCESS_KEY_ID?: string;
  R2_SECRET_ACCESS_KEY?: string;
  R2_BUCKET_NAME?: string;
}
