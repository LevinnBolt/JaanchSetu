#!/bin/sh
set -e
until npx prisma db push --skip-generate --accept-data-loss; do echo "waiting for database..."; sleep 2; done
# Seed once (first start). Re-seed any time with: docker compose exec backend npm run seed:prod
if [ "$(node -e "const {PrismaClient}=require('@prisma/client');const p=new PrismaClient();p.user.count().then(n=>{console.log(n);process.exit(0)}).catch(()=>{console.log(0);process.exit(0)})")" = "0" ]; then
  node dist/seed/seed.js || echo "seed failed"
fi
exec node dist/main.js
