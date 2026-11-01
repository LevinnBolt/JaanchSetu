import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Put,
  Query,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { AuthUser, CurrentUser, Roles } from '../auth/auth.types';
import { FdrsService, ALLOWED_MIME } from './fdrs.service';
import { ReleaseService } from '../release/release.service';
import { CreateFdrDto, FieldReviewDto, ListQuery, RaiseDiscrepancyDto, RejectDto, ResolveDto, WaiveDto, PreflightDto } from './dto';
import { ChecklistDto, DecisionDto, RecommendDto, ReleaseRequestDto } from '../release/dto';
import { config } from '../config';

const upload = FileInterceptor('document', {
  limits: { fileSize: config.maxUploadBytes, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED_MIME.includes(file.mimetype)) {
      return cb(new BadRequestException('Only PDF, JPG or PNG files up to 10 MB are accepted.'), false);
    }
    cb(null, true);
  },
});

@Controller()
export class FdrsController {
  constructor(private fdrs: FdrsService, private release: ReleaseService) {}

  @Get('fdrs')
  list(@CurrentUser() u: AuthUser, @Query() q: ListQuery) {
    return this.fdrs.list(u, q);
  }

  @Get('fdrs/export')
  async export(@CurrentUser() u: AuthUser, @Query() q: ListQuery, @Res() res: Response) {
    const csv = await this.fdrs.exportCsv(u, q);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="jaanchsetu-fdr-export.csv"');
    res.send(csv);
  }

  @Post('fdrs')
  @Roles('INSTITUTION')
  @UseInterceptors(upload)
  create(@CurrentUser() u: AuthUser, @Body() dto: CreateFdrDto, @UploadedFile() file?: Express.Multer.File) {
    return this.fdrs.create(u, dto, file);
  }

  /** Read a scan and compare it with the typed values BEFORE submitting. Saves nothing. */
  @Post('fdrs/preflight')
  @Roles('INSTITUTION')
  @HttpCode(200)
  @UseInterceptors(upload)
  preflight(@CurrentUser() u: AuthUser, @Body() dto: PreflightDto, @UploadedFile() file?: Express.Multer.File) {
    return this.fdrs.preflight(u, dto, file);
  }

  @Get('fdrs/:id')
  async detail(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    const d = await this.fdrs.detail(u, id);
    return { ...d, releaseRequests: await this.release.viewsForFdr(u, id) };
  }

  @Get('fdrs/:id/audit')
  audit(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.fdrs.auditFor(u, id);
  }

  @Post('fdrs/:id/documents')
  @Roles('INSTITUTION')
  @UseInterceptors(upload)
  attach(@CurrentUser() u: AuthUser, @Param('id') id: string, @UploadedFile() file?: Express.Multer.File) {
    if (!file) throw new BadRequestException('Choose a PDF, JPG or PNG file to upload.');
    return this.fdrs.attachDocument(u, id, file);
  }

  @Get('documents/:id/download')
  async download(@CurrentUser() u: AuthUser, @Param('id') id: string, @Res() res: Response) {
    const { doc, data } = await this.fdrs.downloadDocument(u, id);
    res.setHeader('Content-Type', doc.mimeType);
    res.setHeader('Content-Disposition', `inline; filename="${doc.fileName.replace(/[^\w.\-]/g, '_')}"`);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.send(data);
  }

  @Post('fdrs/:id/submit')
  @Roles('INSTITUTION')
  @HttpCode(200)
  submit(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.fdrs.submit(u, id);
  }

  @Post('fdrs/:id/start-scrutiny')
  @Roles('SCRUTINY')
  @HttpCode(200)
  start(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.fdrs.startScrutiny(u, id);
  }

  @Post('fdrs/:id/fields/:key/review')
  @Roles('SCRUTINY')
  @HttpCode(200)
  review(@CurrentUser() u: AuthUser, @Param('id') id: string, @Param('key') key: string, @Body() dto: FieldReviewDto) {
    return this.fdrs.reviewField(u, id, key, dto);
  }

  @Post('fdrs/:id/bank-check')
  @Roles('SCRUTINY')
  @HttpCode(200)
  bankCheck(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.fdrs.bankCheck(u, id);
  }

  @Post('fdrs/:id/accept')
  @Roles('SCRUTINY')
  @HttpCode(200)
  accept(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.fdrs.accept(u, id);
  }

  @Post('fdrs/:id/reject')
  @Roles('SCRUTINY')
  @HttpCode(200)
  reject(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() dto: RejectDto) {
    return this.fdrs.reject(u, id, dto.reason);
  }

  @Post('fdrs/:id/discrepancies')
  @Roles('SCRUTINY')
  raise(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() dto: RaiseDiscrepancyDto) {
    return this.fdrs.raiseManual(u, id, dto.reason, dto.fieldKey);
  }

  @Post('discrepancies/:id/resolve')
  @Roles('SCRUTINY')
  @HttpCode(200)
  resolve(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() dto: ResolveDto) {
    return this.fdrs.closeDiscrepancy(u, id, 'RESOLVED', dto.note);
  }

  @Post('discrepancies/:id/waive')
  @Roles('SCRUTINY')
  @HttpCode(200)
  waive(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() dto: WaiveDto) {
    return this.fdrs.closeDiscrepancy(u, id, 'WAIVED', dto.reason);
  }

  @Post('fdrs/:id/renewal-request')
  @Roles('INSTITUTION')
  @HttpCode(200)
  renewal(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.fdrs.requestRenewal(u, id);
  }

  // ---- release (maker-checker)

  @Post('fdrs/:id/release-requests')
  @Roles('INSTITUTION')
  requestRelease(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() dto: ReleaseRequestDto) {
    return this.release.request(u, id, dto.reason);
  }

  @Put('release-requests/:id/checklist')
  @Roles('SCRUTINY')
  checklist(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() dto: ChecklistDto) {
    return this.release.saveChecklist(u, id, dto.items);
  }

  @Post('release-requests/:id/recommend')
  @Roles('SCRUTINY')
  @HttpCode(200)
  recommend(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() dto: RecommendDto) {
    return this.release.recommend(u, id, dto.note);
  }

  @Post('release-requests/:id/decision')
  @Roles('APPROVER')
  @HttpCode(200)
  decide(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() dto: DecisionDto) {
    return this.release.decide(u, id, dto.approve, dto.reason);
  }
}
