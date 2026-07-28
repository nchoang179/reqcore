<div align="center">

# Reqcore

**The open source ATS for teams drowning in applicants. AI shortlisting that shows its work.**

[![E2E Tests](https://github.com/reqcore-inc/reqcore/actions/workflows/e2e-tests.yml/badge.svg)](https://github.com/reqcore-inc/reqcore/actions/workflows/e2e-tests.yml)
[![PR Validation](https://github.com/reqcore-inc/reqcore/actions/workflows/pr-validation.yml/badge.svg)](https://github.com/reqcore-inc/reqcore/actions/workflows/pr-validation.yml)

[Get Started](https://reqcore.com) · [Pricing](https://reqcore.com/pricing) · [Documentation](ARCHITECTURE.md) · [Roadmap](ROADMAP.md) · [Report Bug](https://github.com/reqcore-inc/reqcore/issues/new)

</div>

---

A flood of applicants turns hiring into a full-time scroll. Reqcore takes every application on a role, runs it through an AI shortlist, and shows you exactly why each candidate was ranked the way they were — no black box. No per-seat fees, unlimited applicants on every plan.

Reqcore is open-core: the full hiring workflow — jobs, pipeline, applications, documents, job board, and AI shortlisting — is AGPLv3 and lives in this repo. A small set of paid, cloud-only features (SSO/SAML, audit log, source analytics) live under [`ee/`](ee) on a separate commercial license. The core scoring and shortlist logic never depends on `ee/` — that's the part self-hosters and evaluators need to be able to trust and verify.

> The fastest way to use Reqcore is the hosted product at [reqcore.com](https://reqcore.com) — free until your first shortlist, no card required. Prefer to run it yourself? See [Self-Hosting](#self-hosting) below.

## Why Reqcore?

*Built for teams drowning in applicants.*

| | **Reqcore** | Greenhouse | Lever | Ashby | OpenCATS |
|---|:---:|:---:|:---:|:---:|:---:|
| **No per-seat pricing** | ✅ | ❌ | ❌ | ❌ | ✅ |
| **Unlimited applicants, every plan** | ✅ | ❌ | ❌ | ❌ | ✅ |
| **AI shortlist with visible scoring** | ✅ | ❌ | ❌ | ❌ | ❌ |
| **Resume parsing** | ✅ | ✅ | ✅ | ✅ | ❌ |
| **Bring your own AI key** | ✅ | ❌ | ❌ | ❌ | ❌ |
| **Open source** | ✅ AGPLv3 | ❌ | ❌ | ❌ | ✅ |
| **Modern tech stack** | Nuxt 4 / Vue 3 | — | — | — | PHP 5 |
| **Active development** | ✅ 2026 | ✅ | ✅ | ✅ | ❌ Stale |
| **Pipeline / Kanban** | ✅ | ✅ | ✅ | ✅ | ❌ |
| **Public job board** | ✅ | ✅ | ✅ | ✅ | ❌ |

## Features

- **AI shortlisting** — Every application gets scored against the job with a visible breakdown of why, not a black-box rank
- **Resume parsing** — Structured data (contact, experience, education, skills) extracted from uploaded resumes automatically
- **Job management** — Create, edit, and track jobs through draft → open → closed → archived
- **Candidate pipeline** — Drag candidates through screening → interview → offer → hired with a Kanban board
- **Public job board** — SEO-friendly job listings with custom slugs that applicants can browse and apply to
- **Custom application forms** — Add custom questions (text, select, file upload, etc.) per job
- **Document storage** — Upload and manage resumes and cover letters via S3-compatible storage (MinIO)
- **Multi-tenant organizations** — Isolated data per organization with role-based membership
- **Recruiter dashboard** — At-a-glance stats, pipeline breakdown, recent applications, and top active jobs
- **GDPR tooling** — Candidate data retention windows, export, and erasure built in
- **Secure document access** — Resumes are never exposed via public URLs; all access is authenticated and streamed
- **Built-in rate limiting** — Protection against abuse on all endpoints out of the box

## Pricing

Reqcore is free to start and priced per active role, not per seat — invite your whole team without increasing the bill.

| Plan | Price | Active roles | Highlights |
|------|-------|:---:|------------|
| **Free** | $0 | 1 | Unlimited applicants, one AI shortlist to try it, bring your own AI key |
| **Solo** | $79/mo | 2 | Unlimited AI shortlists, bring your own AI key, full shortlist workflow |
| **Team** | $239/mo | 8 | Bring your own AI key, deeper per-application analysis, custom domain, integrations |
| **Scale** | $599/mo | 24 | SSO/SAML/SCIM, audit log, DPA/SLA |
| **Agency** | Contact us | Unlimited | Custom contract |

See the live [pricing page](https://reqcore.com/pricing) for full details. Self-hosted instances use the same plan gates — see [Licensing & self-hosting](#licensing--self-hosting).

## Self-Hosting

Reqcore can be run on your own infrastructure with Docker Compose. This is a best-effort, DIY path without support or an SLA — Reqcore's own support and uptime commitments apply only to the hosted product at [reqcore.com](https://reqcore.com).

```bash
mkdir reqcore && cd reqcore
curl -fsSLO https://raw.githubusercontent.com/reqcore-inc/reqcore/main/docker-compose.production.yml
curl -fsSLO https://raw.githubusercontent.com/reqcore-inc/reqcore/main/setup.sh
chmod +x setup.sh
./setup.sh
docker compose -f docker-compose.production.yml up -d
```

Open **[http://localhost:3000](http://localhost:3000)** and sign up.

Code under [`ee/`](ee) gates itself behind the same plan checks as the hosted product, so it stays locked without your own billing configured — no separate license-key server needed.

Full setup instructions (building from source, updating, troubleshooting, managing your instance) live in **[SELF-HOSTING.md](SELF-HOSTING.md)**.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | [Nuxt 4](https://nuxt.com) (Vue 3 + Nitro) |
| Database | PostgreSQL 16 |
| ORM | [Drizzle ORM](https://orm.drizzle.team) + postgres.js |
| Auth | [Better Auth](https://www.better-auth.com) with organization + SSO + Stripe plugins |
| Storage | [MinIO](https://min.io) (S3-compatible) |
| AI | [Vercel AI SDK](https://sdk.vercel.ai) via OpenRouter, or bring your own key (OpenAI-compatible: OpenAI, Anthropic, Google, Ollama, …) |
| Billing | [Stripe](https://stripe.com) |
| Analytics | [PostHog](https://posthog.com) |
| Validation | [Zod v4](https://zod.dev) |
| Styling | [Tailwind CSS v4](https://tailwindcss.com) |
| Icons | [Lucide](https://lucide.dev) (tree-shakeable) |

## Project Structure

```
app/                          # Frontend (Nuxt 4 srcDir)
  pages/                      #   File-based routing
  components/                 #   Auto-imported Vue components
  composables/                #   Auto-imported composables (useJobs, useCandidates, etc.)
  layouts/                    #   Dashboard, auth, and public layouts
server/                       # Backend (Nitro)
  api/                        #   REST API routes (authenticated + public)
  database/schema/            #   Drizzle ORM table definitions
  database/migrations/        #   Generated SQL migrations
  utils/                      #   Auto-imported utilities (db, auth, env, s3, billing, ai)
  plugins/                    #   Startup plugins (migrations, S3 bucket)
ee/                           # Nuxt layer — paid, cloud-only features (separate commercial license)
Dockerfile                    # Multi-stage build for the app container
docker-compose.yml            # App + Postgres + MinIO (+ optional Adminer)
setup.sh                      # One-time secret generator → writes .env
```

## Deployment

The hosted product runs on managed infrastructure. A typical self-hosted production deployment uses:

| Component | Role |
|-----------|------|
| **VPS or container host** | 2 vCPU, 4GB RAM recommended as a starting point |
| **Caddy** | Reverse proxy with automatic HTTPS |
| **Cloudflare** | DNS, DDoS protection, edge SSL (free tier) |
| **Docker Compose** | Postgres + MinIO (localhost only) |
| **systemd** | Process management with auto-restart |

See [ARCHITECTURE.md](ARCHITECTURE.md) for the full deployment architecture diagram.

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start development server |
| `npm run build` | Build for production |
| `npm run db:generate` | Generate migrations from schema changes |
| `npm run db:seed` | Seed database with demo data |
| `npm run db:studio` | Open Drizzle Studio (database browser) |
| `npm run i18n:crowdin:upload` | Upload source locale file to Crowdin |
| `npm run i18n:crowdin:download` | Download latest translations from Crowdin |
| `npm run i18n:crowdin:sync` | Upload sources and then download translations |

## Internationalization

Reqcore uses Nuxt i18n (`@nuxtjs/i18n`) with Crowdin for translation management.
Implementation details and setup steps (including Crowdin native GitHub integration) are documented in [I18N.md](I18N.md).

## Roadmap

Reqcore is actively developed. Here's what's shipped and what's next:

| Status | Milestone |
|--------|-----------|
| ✅ Shipped | Jobs, Candidates, Applications, Pipeline, Documents, Dashboard, Public Job Board, Custom Forms, Resume Parsing, AI Shortlisting, Billing & Plans, GDPR Retention/Erasure |
| 🔨 Building | Team collaboration (comments, activity log, role-based permissions) |
| 🔮 Planned | Interview scheduling, email notifications, candidate portal |

See the full [Roadmap](ROADMAP.md) and [Product Vision](PRODUCT.md).

## Contributing

Contributions are welcome. Please read [CONTRIBUTING.md](CONTRIBUTING.md) before opening an issue or pull request.

## Licensing & self-hosting

Reqcore is licensed under the [GNU Affero General Public License v3.0](LICENSE), with the exception of the [`ee/`](ee) directory, which contains paid, cloud-only features under a separate [commercial license](ee/LICENSE). See [SELF-HOSTING.md](SELF-HOSTING.md) for what that means if you run your own instance.

### Third-party data

The bundled place data used by the job-location picker (`server/utils/geo/data/`) is derived from [GeoNames](https://www.geonames.org), licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Regenerate it with `npx tsx server/scripts/generate-geo-dataset.ts`.
