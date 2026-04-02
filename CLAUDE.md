# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Development
npm run start:dev       # Start with watch mode
npm run build           # Compile TypeScript to dist/

# Testing
npm test                # Run unit tests
npm run test:watch      # Watch mode
npm run test:cov        # With coverage
npm run test:e2e        # End-to-end tests (test/jest-e2e.json config)
# Run a single test file:
npx jest src/modules/auth/auth.service.spec.ts

# Code quality
npm run lint            # ESLint with auto-fix
npm run format          # Prettier format

# Deployment (GCP Cloud Run)
make docker-build       # Build Docker image
make docker-push        # Push to Artifact Registry
make deploy-image       # Deploy to Cloud Run
make logs               # View Cloud Run logs
```

## Environment Configuration

Environment files live in `config/env/{APP_ENV}.env` (dev, qa, prod). The app loads the matching file at startup based on `APP_ENV`. Key variables:
- `SUPABASE_JWT_SECRET`, `SUPABASE_ISSUER`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_URL`
- `QBO_*` — QuickBooks OAuth credentials
- `DUTCHIE_BASE_URL`, `HOMEBASE_BASE_URL`
- `GOOGLE_CLIENT_EMAIL`, `GOOGLE_PRIVATE_KEY`
- `CORS_ORIGINS` — comma-separated allowed origins

Swagger UI is enabled in `dev` and `qa` environments only.

## Architecture Overview

This is a **NestJS data integration backend** for a cannabis retail POS system. It pulls data from external sources and ETLs it into a central Supabase (PostgreSQL) reporting database.

### Data Flow

External APIs → NestJS Services → Supabase PostgreSQL

- **Dutchie** — POS system (inventory, sales, products, employees)
- **Homebase** — HR/scheduling (timecards, shifts)
- **QuickBooks Online** — Accounting (OAuth2 flow, accounts, company info)
- **Supabase** — Central reporting database (all imported data lands here)

### Module Structure (`src/modules/`)

| Module | Purpose |
|--------|---------|
| `auth/` | `SupabaseAuthGuard` — validates Supabase HS256 JWT bearer tokens via `jose` |
| `dutchie/` | Fetches inventory, catalog, reporting, employee data from Dutchie POS API |
| `homebase/` | Fetches timecards and shifts from Homebase API |
| `qbo/` | QuickBooks Online OAuth2 connect/callback flow + accounts/company-info fetch |
| `supabase/` | Bulk ETL import endpoints — receives data arrays and upserts into Supabase |
| `wg-pos/` | Main sync orchestration — coordinates Dutchie → Supabase and receipt imports |
| `pistil/` | Pistil store imports |
| `health/` | GET `/health` liveness check |

### Common Patterns

**Authentication:** Apply `@UseGuards(SupabaseAuthGuard)` to protect controllers/routes. The guard validates the `Authorization: Bearer <token>` header against Supabase JWT settings.

**Supabase client:** Injected via `SupabaseProvider` from `src/common/supabase/`. Use the service role key client for server-side operations (bypasses RLS).

**Import endpoints:** Bulk import services accept array payloads with optional store filter query params and return `{ count, elapsedMs }` response shapes.

**Store config pattern:** `dutchie/` and `homebase/` modules have a `store-config.service.ts` that maps store identifiers to API credentials/configs.

**No ORM:** The codebase uses the Supabase JS client directly (`supabase.from(...).upsert(...)`) — there is no TypeORM or Prisma.

### Deployment

The app runs on **Google Cloud Run** (port 8080, `0.0.0.0`). Secrets are stored in GCP Secret Manager and converted to env vars via `scripts/env_to_yaml.py`. The Dockerfile is a multi-stage build (Node 20-alpine) that copies `dist/` and `config/` into the runtime image.
