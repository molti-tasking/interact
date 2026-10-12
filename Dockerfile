# Production image for the frontend (apps/docs), e.g. for Coolify's
# "Dockerfile" build pack (Base Directory: /). The default Nixpacks setup
# works too — this is the more predictable alternative.
#
# Build args (Coolify: tick "Build Variable"):
#   NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY
# Runtime env:
#   SUPABASE_DB_URL (migrations are applied on start), LLM_*, LANGFUSE_* …

FROM node:22-slim

RUN corepack enable
WORKDIR /app

COPY . .

ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL \
    NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY \
    NEXT_TELEMETRY_DISABLED=1

RUN pnpm install --frozen-lockfile && pnpm build

ENV NODE_ENV=production \
    PORT=3000
EXPOSE 3000

# Applies pending Supabase migrations, then starts Next.js.
CMD ["pnpm", "start"]
