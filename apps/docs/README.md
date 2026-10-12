This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Supabase

Start the local Supabase instance:

```bash
npx supabase start
```

After changing the database schema (migrations in `supabase/migrations/`), regenerate the TypeScript types:

```bash
npx supabase gen types typescript --local > src/lib/supabase/database.types.ts
```

The generated `database.types.ts` file is **auto-generated — do not edit it manually**.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Coolify (with self-hosted Supabase)

Application settings:

- **Base Directory:** `/` (repo root — the app depends on the `interact` workspace package)
- **Build pack:** Nixpacks with `NIXPACKS_NODE_VERSION=22`, or Dockerfile (uses the root `Dockerfile`)
- **Install / Build / Start** (Nixpacks): `pnpm install --frozen-lockfile` / `pnpm build` / `pnpm start`
- **Port:** `3000`

Environment variables:

| Variable | Notes |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Tick **Build Variable** — inlined at build time |
| `SUPABASE_DB_URL` | Runtime only. `postgresql://postgres:<password>@supabase-db-<uuid>:5432/postgres` |
| `LLM_HOST`, `LLM_API_KEY`, `LLM_MODEL_NAME`, … | See `.env.template` |

**Migrations are applied automatically on every start:** `pnpm start` runs
`db:migrate` (`supabase db push`) before `next start`. Already-applied
migrations are skipped; if one fails, the new container doesn't start and
Coolify keeps the previous version running. For the frontend to reach the
database by container name, enable **Connect To Predefined Network** on the
Supabase service. Run manually with `SUPABASE_DB_URL=… pnpm db:migrate`.

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
