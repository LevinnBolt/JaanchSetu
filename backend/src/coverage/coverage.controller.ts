import { Controller, ForbiddenException, Get, Param, Query } from '@nestjs/common';
import { AuthUser, CurrentUser, isInstitution } from '../auth/auth.types';
import { CoverageService } from './coverage.service';

@Controller('coverage')
export class CoverageController {
  constructor(private coverage: CoverageService) {}

  /** Officers: every institution with a requirement, most urgent first. */
  @Get()
  overview(@CurrentUser() u: AuthUser, @Query('status') status?: string, @Query('q') q?: string, @Query('page') page?: string, @Query('pageSize') pageSize?: string) {
    if (isInstitution(u)) throw new ForbiddenException('The coverage overview is for officials. Open your own institution instead.');
    const ok = ['SHORTFALL', 'AT_RISK', 'WATCH', 'OK'];
    return this.coverage.overview({ status: status && ok.includes(status) ? status : undefined, q: q?.slice(0, 80), page: Number(page) || 1, pageSize: Number(pageSize) || 15 });
  }

  @Get('institution/:id')
  one(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.coverage.forInstitution(u, id);
  }
}
