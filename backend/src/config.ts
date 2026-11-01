import * as dotenv from 'dotenv';
import * as path from 'path';

// Root .env first (docker-compose style), then backend/.env. Real env vars always win.
dotenv.config({ path: path.resolve(__dirname, '../../.env') });
dotenv.config();

const env = process.env;

export const config = {
  port: Number(env.PORT || 4000),
  jwtSecret: env.JWT_SECRET || 'dev-only-secret-change-me',
  jwtExpiresIn: env.JWT_EXPIRES_IN || '8h',
  demoMode: env.DEMO_MODE !== 'false',
  corsOrigin: env.CORS_ORIGIN || 'http://localhost:5173',
  // Address people use to open the app. The QR code on a release order points here (/verify/<order no>).
  publicUrl: env.PUBLIC_URL || 'http://localhost:5173',

  // 32-byte AES-256 key as 64 hex chars. The default is for local demos only.
  fileEncKey: env.FILE_ENC_KEY || '5341404b5348492d323032362d44454d4f2d4b45592d4e4f542d464f522d5052',

  storageDriver: (env.STORAGE_DRIVER || 's3') as 's3' | 'local',
  localStorageDir: env.LOCAL_STORAGE_DIR || path.resolve(__dirname, '../storage'),
  s3: {
    endpoint: env.S3_ENDPOINT || 'http://localhost:9000',
    region: env.S3_REGION || 'us-east-1',
    bucket: env.S3_BUCKET || 'sakshi-documents',
    accessKey: env.S3_ACCESS_KEY || 'minioadmin',
    secretKey: env.S3_SECRET_KEY || 'minioadmin',
  },

  redisUrl: env.REDIS_URL || 'redis://localhost:6379',
  smtp: { host: env.SMTP_HOST || 'localhost', port: Number(env.SMTP_PORT || 1025), user: env.SMTP_USER || '', pass: env.SMTP_PASS || '', secure: env.SMTP_SECURE === 'true' },
  mailFrom: env.MAIL_FROM || 'sakshi@demo.test',

  // Real bank verification. Leave BANK_API_URL empty to use the labelled simulator. See README, 'Connecting a bank'.
  bank: { url: env.BANK_API_URL || '', apiKey: env.BANK_API_KEY || '', timeoutMs: Number(env.BANK_API_TIMEOUT_MS || 8000), name: env.BANK_API_NAME || 'External bank API' },

  tessdataPath: env.TESSDATA_PATH || '',
  maxUploadBytes: 10 * 1024 * 1024,
};

export const DEMO_PASSWORD = 'demo123';
