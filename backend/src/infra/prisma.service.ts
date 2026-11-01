import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import '../config';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  async onModuleInit() {
    await this.$connect();
  }
  async onModuleDestroy() {
    await this.$disconnect();
  }
}

/** Audit rows are append-only: the database itself refuses UPDATE and DELETE. */
export async function ensureAuditImmutability(prisma: PrismaClient) {
  await prisma.$executeRawUnsafe(`
    CREATE OR REPLACE FUNCTION sakshi_audit_immutable() RETURNS trigger AS $$
    BEGIN
      RAISE EXCEPTION 'AuditLog is append-only: % is not allowed', TG_OP;
    END;
    $$ LANGUAGE plpgsql;
  `);
  await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS audit_immutable ON "AuditLog";`);
  await prisma.$executeRawUnsafe(`
    CREATE TRIGGER audit_immutable BEFORE UPDATE OR DELETE ON "AuditLog"
    FOR EACH ROW EXECUTE FUNCTION sakshi_audit_immutable();
  `);
}
