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

## Access control

The workspace and all collected data are private; only published forms are public.

| Who | Can do |
| --- | --- |
| Anyone with a form link | Load a **published** form (title, fields, purpose) and submit a response, incl. file uploads |
| Signed-in admin (`app_admins`) | Everything: all forms incl. drafts, responses, files, LLM features |
| Anyone else (also other signed-in accounts) | Nothing — redirected to `/login`, no data access |

How it's enforced:

- **Database** (`supabase/migrations/010_private_responses.sql`): the anon key has no table access. Respondents go through two functions, `get_published_form` and `submit_response`, which only work for published forms. All tables have RLS policies that allow admins only. The `response-files` bucket is private: respondents may upload, only admins can read (signed URLs).
- **App**: `src/proxy.ts` redirects signed-out visitors to `/login` (except `/forms/*`). Every server action and API route calls `requireOwner()` (via `guardLlmRequest`), because server actions can be called from any page.

**Setup (once per Supabase instance):**

1. Turn off public sign-ups. Self-hosted / Coolify: `DISABLE_SIGNUP=true` in the Supabase service. Hosted: Authentication → Sign In / Providers → disable "Allow new users to sign up". Local: `enable_signup = false` in `supabase/config.toml`.
2. Create your account: Studio → Authentication → Users → **Add user** (email + password, auto-confirm).
3. Make it an admin (Studio → SQL editor):

   ```sql
   INSERT INTO public.app_admins (user_id)
   SELECT id FROM auth.users WHERE email = 'you@example.com';
   ```

Publishing a form = setting its status to *published* in the workspace; unpublishing stops new submissions immediately. New tables need RLS plus an `app_admin_all` policy (see migration 010), otherwise the app can't reach them.

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
