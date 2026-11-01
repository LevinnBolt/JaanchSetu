import { Injectable } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { istDateString, istMidnightUtc, utcMidnight } from '../domain/dates';

/**
 * The "demo clock". When an admin sets a demo date, everything that cares about "today"
 * (reminders, maturity status, dashboards) uses it instead of the real date.
 */
@Injectable()
export class ClockService {
  constructor(private prisma: PrismaService) {}

  async demoDate(): Promise<string | null> {
    const s = await this.prisma.setting.findUnique({ where: { key: 'demoDate' } });
    return s?.value || null;
  }

  async setDemoDate(dateStr: string | null) {
    if (!dateStr) await this.prisma.setting.deleteMany({ where: { key: 'demoDate' } });
    else
      await this.prisma.setting.upsert({
        where: { key: 'demoDate' },
        update: { value: dateStr },
        create: { key: 'demoDate', value: dateStr },
      });
  }

  /** Current instant on the (possibly shifted) clock. */
  async now(): Promise<Date> {
    const real = new Date();
    const demo = await this.demoDate();
    if (!demo) return real;
    const shift = utcMidnight(demo).getTime() - istMidnightUtc(real).getTime();
    return new Date(real.getTime() + shift);
  }

  /** Today's date as a UTC-midnight Date. */
  async today(): Promise<Date> {
    return utcMidnight(istDateString(await this.now()));
  }

  async info() {
    const demo = await this.demoDate();
    const realToday = istDateString(new Date());
    return { demoDate: demo, realToday, isShifted: !!demo && demo !== realToday, today: demo ?? realToday };
  }
}
