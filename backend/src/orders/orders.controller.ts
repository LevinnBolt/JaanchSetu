import { Controller, Get, HttpException, HttpStatus, Param, Req, Res } from '@nestjs/common';
import type { Response } from 'express';
import { AuthUser, CurrentUser, Public } from '../auth/auth.types';
import { RateLimiter } from '../domain/rate-limiter';
import { OrdersService } from './orders.service';

@Controller()
export class OrdersController {
  private limiter = new RateLimiter(60, 60_000);
  constructor(private orders: OrdersService) {}

  /** No sign-in: this is what the QR code on the order opens. It returns only minimal, non-sensitive details. */
  @Public()
  @Get('public/orders/:orderNo')
  verify(@Param('orderNo') orderNo: string, @Req() req: any) {
    if (!/^JSRO-\d{8}-[A-Z0-9]{6}$/.test(orderNo)) throw new HttpException('That is not a valid order number.', HttpStatus.BAD_REQUEST);
    if (!this.limiter.hit(String(req.ip))) throw new HttpException('Too many checks. Please wait a minute.', HttpStatus.TOO_MANY_REQUESTS);
    return this.orders.verifyPublic(orderNo);
  }

  @Get('release-orders/:orderNo/pdf')
  async pdf(@CurrentUser() u: AuthUser, @Param('orderNo') orderNo: string, @Res() res: Response) {
    const buf = await this.orders.pdf(u, orderNo);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${orderNo}.pdf"`);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.send(buf);
  }
}
