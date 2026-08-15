# Reqcore UI screenshots (redesign reference)

Full-page captures of every main screen at `1440×900`, logged in as the demo account where needed.

**Folder:** `ui-redesign-screenshots/`  
**Manifest:** `manifest.json` (route → filename map)  
**Re-run:** `node ui-redesign-screenshots/capture.mjs` (app must be on `http://localhost:3000`)

## Public / marketing / auth

| File | Route |
|------|-------|
| `00-home.png` | `/` |
| `01-pricing.png` | `/pricing` |
| `02-jobs-board.png` | `/jobs` |
| `03-job-detail.png` | `/jobs/:slug` |
| `04-job-apply.png` | `/jobs/:slug/apply` |
| `05-job-confirmation.png` | `/jobs/:slug/confirmation` |
| `06-career-page.png` | `/career/:slug` |
| `07-auth-sign-in.png` | `/auth/sign-in` |
| `08-auth-sign-up.png` | `/auth/sign-up` |
| `09-auth-forgot-password.png` | `/auth/forgot-password` |
| `10-auth-reset-password.png` | `/auth/reset-password` |
| `11-auth-fresh-signup.png` | `/auth/fresh-signup` |
| `12-onboarding-welcome.png` | `/onboarding/welcome` |
| `13-onboarding-create-org.png` | `/onboarding/create-org` |
| `14-interview-respond.png` | `/interview/respond` |

## Dashboard (demo org)

| File | Route |
|------|-------|
| `20-dashboard.png` | `/dashboard` |
| `21-dashboard-jobs.png` | `/dashboard/jobs` |
| `22-dashboard-jobs-new.png` | `/dashboard/jobs/new` |
| `23–32` | Job detail tabs (settings, form, candidates, AI, promote, rules, source tracking, import) |
| `33–36` | Candidates list / new / import / detail |
| `37–38` | Applications list / detail |
| `39–42` | Interviews + templates |
| `43–44` | Source tracking |
| `45–48` | AI analysis, chatbot, timeline, updates |
| `49–61` | Settings (account, members, notifications, billing, integrations, localization, retention, SSO, career page, AI) |

Not captured (token/ID-specific or empty): accept-invitation, join-by-token, interview template edit by id, chatbot thread by id.
