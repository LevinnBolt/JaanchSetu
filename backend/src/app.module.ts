import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { config } from './config';
import { PrismaService } from './infra/prisma.service';
import { ClockService } from './infra/clock.service';
import { AuditService } from './infra/audit.service';
import { StorageService } from './infra/storage.service';
import { MailService } from './infra/mail.service';
import { NotifyService } from './infra/notify.service';
import { OcrService } from './infra/ocr.service';
import { LifecycleService } from './infra/lifecycle.service';
import { BankService } from './infra/bank.service';
import { JwtAuthGuard, RolesGuard } from './auth/guards';
import { AuthController } from './auth/auth.controller';
import { FdrsService } from './fdrs/fdrs.service';
import { FdrsController } from './fdrs/fdrs.controller';
import { ReleaseService } from './release/release.service';
import { RadarService } from './radar/radar.service';
import { SchedulerService } from './radar/scheduler.service';
import { NotificationsController } from './radar/notifications.controller';
import { DashboardService } from './dashboard/dashboard.service';
import { DashboardController } from './dashboard/dashboard.controller';
import { AdminController } from './admin/admin.controller';
import { AuditController } from './audit/audit.controller';
import { DemoController } from './demo/demo.controller';
import { ReportsController } from './reports/reports.controller';
import { OrdersController } from './orders/orders.controller';
import { CoverageController } from './coverage/coverage.controller';
import { CoverageService } from './coverage/coverage.service';
import { OrdersService } from './orders/orders.service';
import { ResolutionController } from './resolution/resolution.controller';
import { ResolutionService } from './resolution/resolution.service';
import { ResolutionMonitorService } from './resolution/resolution-monitor.service';
import { ReportsService } from './reports/reports.service';

@Module({
  imports: [JwtModule.register({ global: true, secret: config.jwtSecret, signOptions: { expiresIn: config.jwtExpiresIn } })],
  controllers: [AuthController, FdrsController, NotificationsController, DashboardController, AdminController, AuditController, DemoController, ReportsController, OrdersController, CoverageController, ResolutionController],
  providers: [
    PrismaService,
    ClockService,
    AuditService,
    StorageService,
    MailService,
    NotifyService,
    OcrService,
    LifecycleService,
    BankService,
    FdrsService,
    ReleaseService,
    RadarService,
    SchedulerService,
    DashboardService,
    ReportsService,
    OrdersService,
    CoverageService,
    ResolutionService,
    ResolutionMonitorService,
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule {}
