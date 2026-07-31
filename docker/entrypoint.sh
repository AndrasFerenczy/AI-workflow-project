#!/bin/sh
set -e

cd /app

echo "[docker] Applying database schema…"
npx prisma db push

if [ "${SEED_ON_START:-true}" = "true" ]; then
  echo "[docker] Seeding demo workflows…"
  npm run db:seed
else
  echo "[docker] Skipping seed (SEED_ON_START=${SEED_ON_START})"
fi

echo "[docker] Starting Next.js on ${HOSTNAME:-0.0.0.0}:${PORT:-3000}"
exec npx next start --hostname "${HOSTNAME:-0.0.0.0}" --port "${PORT:-3000}"
