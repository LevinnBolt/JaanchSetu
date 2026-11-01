import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { CreateBucketCommand, GetObjectCommand, HeadBucketCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import * as fs from 'fs/promises';
import * as path from 'path';
import { config } from '../config';

const ALGO = 'aes-256-gcm';

/** Blob layout: iv(12) | auth tag(16) | ciphertext */
export function encryptBuffer(plain: Buffer, keyHex = config.fileEncKey): Buffer {
  const key = Buffer.from(keyHex, 'hex');
  if (key.length !== 32) throw new Error('FILE_ENC_KEY must be 64 hex characters (32 bytes, AES-256).');
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, key, iv);
  const enc = Buffer.concat([cipher.update(plain), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), enc]);
}

export function decryptBuffer(blob: Buffer, keyHex = config.fileEncKey): Buffer {
  const key = Buffer.from(keyHex, 'hex');
  const iv = blob.subarray(0, 12);
  const tag = blob.subarray(12, 28);
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(blob.subarray(28)), decipher.final()]);
}

/**
 * S3-compatible object storage (MinIO locally). Every object is AES-256-GCM encrypted before it
 * leaves this process, so the bucket only ever holds ciphertext. `STORAGE_DRIVER=local` keeps the
 * same encrypted blobs on disk for running without MinIO.
 */
@Injectable()
export class StorageService implements OnModuleInit {
  private log = new Logger('Storage');
  private s3?: S3Client;

  async onModuleInit() {
    if (config.storageDriver === 'local') {
      await fs.mkdir(config.localStorageDir, { recursive: true });
      this.log.log(`Using encrypted local storage at ${config.localStorageDir}`);
      return;
    }
    this.s3 = new S3Client({
      endpoint: config.s3.endpoint,
      region: config.s3.region,
      forcePathStyle: true,
      credentials: { accessKeyId: config.s3.accessKey, secretAccessKey: config.s3.secretKey },
    });
    try {
      await this.s3.send(new HeadBucketCommand({ Bucket: config.s3.bucket }));
    } catch {
      try {
        await this.s3.send(new CreateBucketCommand({ Bucket: config.s3.bucket }));
        this.log.log(`Created bucket ${config.s3.bucket}`);
      } catch (e) {
        this.log.warn(`Object storage not reachable at ${config.s3.endpoint}: ${(e as Error).message}`);
      }
    }
  }

  async put(key: string, plain: Buffer): Promise<void> {
    const blob = encryptBuffer(plain);
    if (config.storageDriver === 'local') {
      const file = path.join(config.localStorageDir, key);
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file, blob);
      return;
    }
    await this.s3!.send(new PutObjectCommand({ Bucket: config.s3.bucket, Key: key, Body: blob, ContentType: 'application/octet-stream' }));
  }

  async get(key: string): Promise<Buffer> {
    let blob: Buffer;
    if (config.storageDriver === 'local') {
      blob = await fs.readFile(path.join(config.localStorageDir, key));
    } else {
      const res = await this.s3!.send(new GetObjectCommand({ Bucket: config.s3.bucket, Key: key }));
      blob = Buffer.from(await res.Body!.transformToByteArray());
    }
    return decryptBuffer(blob);
  }
}
