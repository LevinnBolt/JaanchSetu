import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Queue, Worker } from 'bullmq';
import IORedis from 'ioredis';
import { config } from '../config';
import { RadarService } from './radar.service';

/**
 * Daily Maturity Radar job on BullMQ + Redis. If Redis is not reachable (for example when running
 * the API without docker) it falls back to an in-process timer so the demo still works.
 */
@Injectable()
export class SchedulerService implements OnModuleInit, OnModuleDestroy {
  private log = new Logger('Scheduler');
  private queue?: Queue;
  private worker?: Worker;
  private conns: IORedis[] = [];
  private timer?: NodeJS.Timeout;

  constructor(private radar: RadarService) {}

  async onModuleInit() {
    if (process.env.DISABLE_SCHEDULER === 'true') return;
    try {
      await this.startBull();
      this.log.log('BullMQ scheduler ready: Maturity Radar runs daily at 06:00 IST');
    } catch (e) {
      this.log.warn(`Redis unavailable (${(e as Error).message}). Falling back to an in-process timer every 6 hours.`);
      await this.cleanup();
      this.timer = setInterval(() => this.radar.run().catch((err) => this.log.error(err)), 6 * 3600 * 1000);
    }
  }

  private async startBull() {
    const probe = new IORedis(config.redisUrl, { lazyConnect: true, maxRetriesPerRequest: 1, retryStrategy: () => null, connectTimeout: 2000 });
    probe.on('error', () => undefined);
    try {
      await probe.connect();
      await probe.ping();
    } finally {
      probe.disconnect();
    }
    const mk = () => {
      const c = new IORedis(config.redisUrl, { maxRetriesPerRequest: null });
      c.on('error', (err) => this.log.warn(`Redis: ${err.message}`));
      this.conns.push(c);
      return c;
    };
    this.queue = new Queue('maturity-radar', { connection: mk() });
    this.worker = new Worker('maturity-radar', async () => this.radar.run(), { connection: mk() });
    this.worker.on('failed', (_job, err) => this.log.error(`Radar job failed: ${err.message}`));
    await this.queue.upsertJobScheduler('daily-radar', { pattern: '0 6 * * *', tz: 'Asia/Kolkata' }, { name: 'run' });
  }

  private async cleanup() {
    await this.worker?.close().catch(() => undefined);
    await this.queue?.close().catch(() => undefined);
    for (const c of this.conns) c.disconnect();
    this.conns = [];
    this.worker = undefined;
    this.queue = undefined;
  }

  /** Queue a radar run now (used by the admin "Run radar now" button). */
  async runNow() {
    if (this.queue) {
      await this.queue.add('manual', {}, { removeOnComplete: true, removeOnFail: true });
      return { queued: true as const };
    }
    return { queued: false as const, summary: await this.radar.run() };
  }

  async onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
    await this.cleanup();
  }
}
