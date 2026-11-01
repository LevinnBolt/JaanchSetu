import { Controller, Get, Param, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { AuthUser, CurrentUser } from '../auth/auth.types';
import { ReportsService } from './reports.service';

@Controller('reports')
export class ReportsController {
  constructor(private reports: ReportsService) {}

  @Get()
  list() {
    return this.reports.definitions();
  }

  @Get(':key')
  async one(@CurrentUser() u: AuthUser, @Param('key') key: string, @Query('page') page?: string, @Query('pageSize') pageSize?: string, @Query('days') days?: string, @Query('format') format?: string, @Res({ passthrough: true }) res?: Response) {
    const o = { page: Number(page) || 1, pageSize: Number(pageSize) || 15, days: Number(days) || undefined };
    if (format === 'csv') {
      const csv = await this.reports.csv(u, key, o);
      res!.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res!.setHeader('Content-Disposition', `attachment; filename="jaanchsetu-${key.replace(/[^a-z-]/g, '')}.csv"`);
      return csv;
    }
    return this.reports.run(u, key, o);
  }
}
