// https://nuxt.com/docs/api/configuration/nuxt-config
import { copyFile, mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import tailwindcss from "@tailwindcss/vite";

// Resolved here so the build fails loudly at config load if pdfjs-dist ever
// moves the file, rather than silently shipping a server that can't read PDFs.
const pdfjsWorkerPath = createRequire(import.meta.url).resolve(
  "pdfjs-dist/legacy/build/pdf.worker.mjs",
);

const railwayEnvironmentName =
  process.env.RAILWAY_ENVIRONMENT_NAME?.toLowerCase() ?? "";
const railwayPublicDomain =
  process.env.RAILWAY_PUBLIC_DOMAIN?.toLowerCase() ?? "";
const siteUrl = process.env.NUXT_PUBLIC_SITE_URL || "https://reqcore.com";
const i18nDefaultLocale = "en";
const i18nLocales = [
  { code: "en", language: "en-US", name: "English", file: "en.json" },
  {
    code: "es",
    language: "es-ES",
    name: "Español",
    file: "es.json",
    partial: true,
  },
  {
    code: "fr",
    language: "fr-FR",
    name: "Français",
    file: "fr.json",
    partial: true,
  },
  {
    code: "de",
    language: "de-DE",
    name: "Deutsch",
    file: "de.json",
    partial: true,
  },
  { code: "nb", language: "nb-NO", name: "Norsk Bokmål", file: "nb.json" },
  {
    code: "vi",
    language: "vi-VN",
    name: "Tiếng Việt",
    file: "vi.json",
    partial: true,
  },
];

const localizedPublicRouteRules = Object.fromEntries(
  i18nLocales
    .filter((locale) => locale.code !== i18nDefaultLocale)
    .flatMap((locale) => [
      [`/${locale.code}/pricing`, { isr: 3600 }],
      [`/${locale.code}/jobs`, { isr: 3600 }],
      [`/${locale.code}/jobs/**`, { isr: 3600 }],
    ]),
);

const localizedPricingRedirectRules = Object.fromEntries(
  i18nLocales
    .filter((locale) => locale.code !== i18nDefaultLocale)
    .map((locale) => [
      `/${locale.code}/pricing-v5`,
      { redirect: { to: `/${locale.code}/pricing`, statusCode: 301 } },
    ]),
);

// Allow search-engine indexing for localized public *marketing* pages only.
// Pricing is genuinely translated, so its localized variants are indexable.
//
// Job postings and career pages are NOT listed here on purpose: their content
// (job title/description, org headline) is recruiter-authored in a single
// language and served verbatim under every locale prefix — the surrounding UI
// chrome is the only thing translated. Indexing /es/jobs/x, /fr/career/x, … as
// separate URLs would publish 6× near-duplicate, untranslated pages with
// hreflang claiming translations that don't exist. Instead these localized
// variants inherit the default "noindex, nofollow" (the `/**` rule below), so
// only the unprefixed default-locale URL is indexed while applicants can still
// browse/apply in their language. See app/pages/{jobs,career}/[slug]/index.vue.
const localizedPublicRobotsRules = Object.fromEntries(
  i18nLocales
    .filter((locale) => locale.code !== i18nDefaultLocale)
    .map((locale) => [
      `/${locale.code}/pricing`,
      { headers: { "X-Robots-Tag": "index, follow" } },
    ]),
);

const isRailwayPreview =
  railwayEnvironmentName.startsWith("pr") ||
  railwayEnvironmentName.includes("pr-") ||
  railwayEnvironmentName.includes("pull request") ||
  railwayEnvironmentName.includes("pull-request") ||
  railwayEnvironmentName.includes("preview") ||
  railwayPublicDomain.includes("-pr-");

export default defineNuxtConfig({
  compatibilityDate: "2025-07-15",
  devtools: { enabled: true },

  // Enterprise Edition layer — see ee/README.md and ee/LICENSE. Code here is
  // licensed separately from the AGPLv3 core and gated behind paid plan
  // features at runtime (assertPlanFeature); it stays merged into every
  // build since Reqcore only ships one hosted deployment.
  extends: ["./ee"],

  modules: [
    "@nuxtjs/i18n",
    "@nuxtjs/mdc",
    // Only load PostHog module when the API key is available;
    // the SDK crashes during prerender/build if the key is empty.
    ...(process.env.POSTHOG_PUBLIC_KEY ? ["@posthog/nuxt" as const] : []),
  ],

  css: ["~/assets/css/main.css"],

  // ─────────────────────────────────────────────
  // PostHog — privacy-focused product analytics & feature flags
  // ─────────────────────────────────────────────
  // Enable source maps so PostHog error tracking can display readable stack traces
  sourcemap: {
    client: process.env.NODE_ENV === "production" ? "hidden" : false,
  },

  // @ts-ignore - posthogConfig types only available when @posthog/nuxt module is loaded
  posthogConfig: {
    publicKey: process.env.POSTHOG_PUBLIC_KEY || "",
    host: process.env.POSTHOG_HOST || "https://eu.i.posthog.com",
    clientConfig: {
      // ── Reverse proxy: route PostHog through reqcore.com to bypass ad blockers ──
      // Requests to /ingest/** are proxied by Nitro to eu.i.posthog.com
      api_host: "/ingest",
      ui_host: "https://eu.posthog.com",
      // ── Privacy: disable invasive features ──
      autocapture: false,
      disable_session_recording: true,
      enable_recording_console_log: false,
      disable_surveys: true,
      capture_pageview: true,
      capture_pageleave: true,
      // ── Error tracking: capture unhandled errors and rejections ──
      capture_exceptions: {
        capture_unhandled_errors: true,
        capture_unhandled_rejections: true,
        capture_console_errors: false,
      },
      // ── Cookieless tracking — default for visitors who haven't accepted ──
      // `persistence: 'sessionStorage'` keeps the distinct_id in the tab's
      // sessionStorage only.  Nothing is written to cookies or persistent
      // localStorage, and the id is wiped when the tab closes — there is no
      // cross-session tracking and no cross-site identifier (sessionStorage
      // is per-origin, per-tab).
      //
      // We deliberately avoid `persistence: 'memory'` here: with memory
      // persistence every page navigation regenerates the distinct_id,
      // which silently shatters any multi-page funnel (signup → onboarding
      // → dashboard → jobs) for unconsented users — every step is attributed
      // to a different anonymous person, so funnel conversion appears as 0.
      //
      // `person_profiles: 'identified_only'` means anonymous visitors flow as
      // events without creating person profiles, while logged-in users get a
      // stable profile keyed by their auth user-id (via posthog.identify()).
      // This gives us reliable funnel + retention analytics for real users
      // without persistently tracking anonymous visitors across sessions.
      persistence: "sessionStorage",
      person_profiles: "identified_only",
      // ── GDPR: drop IP address from events ──
      // PostHog uses $ip server-side for GeoIP, but we do not need it for the
      // SaaS analytics use case.  Denylisting it minimises personal data sent.
      property_denylist: ["$ip", "$initial_ip"],
    },
    serverConfig: {
      // Disabled: the @posthog/nuxt Nitro plugin captures ALL errors
      // (including 404s from bot scanners). We use a filtered error hook
      // in server/plugins/posthog.ts instead.
      enableExceptionAutocapture: false,
    },
  },

  i18n: {
    baseUrl: siteUrl,
    defaultLocale: i18nDefaultLocale,
    strategy: "prefix_except_default",
    locales: i18nLocales,
    langDir: "locales",
    detectBrowserLanguage: {
      useCookie: true,
      cookieKey: "reqcore_i18n_redirected",
      redirectOn: "root",
    },
    vueI18n: "./i18n.config.ts",
  },

  // ─────────────────────────────────────────────
  // Global <head> — lang, title template, favicon
  // ─────────────────────────────────────────────
  app: {
    head: {
      titleTemplate: "%s — Reqcore",
      link: [
        { rel: "icon", type: "image/png", href: "/favicon.png" },
        { rel: "icon", type: "image/svg+xml", href: "/favicon.svg" },
        {
          rel: "apple-touch-icon",
          sizes: "180x180",
          href: "/apple-touch-icon.png",
        },
      ],
      meta: [
        { name: "theme-color", content: "#09090b" },
        {
          name: "viewport",
          content: "width=device-width, initial-scale=1.0, maximum-scale=5.0",
        },
      ],
      // Dark-mode init script is injected in app/app.vue via useHead() with
      // the per-request nonce so it is allowed by the nonce-based CSP.
      // Plausible removed — PostHog handles all analytics
    },
  },

  runtimeConfig: {
    public: {
      /** Base URL of the marketing site (reqcore-web) for cross-domain links */
      marketingUrl:
        process.env.NUXT_PUBLIC_MARKETING_URL || "https://reqcore.com",
      /** Cookie domain for cross-subdomain sharing (e.g. '.reqcore.com') */
      cookieDomain: process.env.NUXT_PUBLIC_COOKIE_DOMAIN || "",
      // PostHog runtimeConfig is managed by @posthog/nuxt via posthogConfig above.
      // Override at runtime with NUXT_PUBLIC_POSTHOG_PUBLIC_KEY / NUXT_PUBLIC_POSTHOG_HOST.
      /** When set, the dashboard shows a read-only demo banner for this org slug */
      demoOrgSlug:
        process.env.DEMO_ORG_SLUG || (isRailwayPreview ? "reqcore-demo" : ""),
      /** Public live-demo account email used to prefill sign-in */
      liveDemoEmail: (() => {
        const email =
          process.env.LIVE_DEMO_EMAIL ||
          process.env.DEMO_EMAIL ||
          "demo@reqcore.com";
        // Guard against stale applirank.com domain from old env vars
        if (email.endsWith("@applirank.com")) {
          console.warn(
            "[config] Stale demo email detected (applirank.com domain) — falling back to demo@reqcore.com",
          );
          return "demo@reqcore.com";
        }
        return email;
      })(),
      /** Public live-demo passcode used to prefill sign-in */
      liveDemoPasscode:
        process.env.LIVE_DEMO_SECRET || process.env.DEMO_PASSWORD || "demo1234",
      /** Whether in-app feedback via GitHub Issues is enabled */
      feedbackEnabled: !!(
        process.env.GITHUB_FEEDBACK_TOKEN && process.env.GITHUB_FEEDBACK_REPO
      ),
      /** Whether OIDC SSO is enabled (all three OIDC env vars are set) */
      oidcEnabled: !!(
        process.env.OIDC_CLIENT_ID &&
        process.env.OIDC_CLIENT_SECRET &&
        process.env.OIDC_DISCOVERY_URL
      ),
      /** Display name for the SSO provider button */
      oidcProviderName: process.env.OIDC_PROVIDER_NAME || "SSO",
    },
  },

  vite: {
    plugins: [tailwindcss()],
  },

  // ─────────────────────────────────────────────
  // Route rules — ISR for public marketing pages
  // ─────────────────────────────────────────────
  routeRules: {
    // ── PostHog reverse proxy ──
    // Handled by server/routes/ingest/[...path].ts (which routes /ingest/static/**
    // to eu-assets.i.posthog.com and everything else to eu.i.posthog.com).
    // Defining routeRules here would be shadowed by the server route, so we
    // intentionally do not declare them.
    "/pricing-v5": { redirect: { to: "/pricing", statusCode: 301 } },
    ...localizedPricingRedirectRules,
    "/pricing": { isr: 3600 },
    "/jobs": { isr: 3600 },
    "/jobs/**": { isr: 3600 },
    ...localizedPublicRouteRules,
  },

  nitro: {
    experimental: {
      tasks: true,
    },
    hooks: {
      // pdfjs-dist builds its worker import specifier at runtime, so Nitro's
      // dependency tracer never sees pdf.worker.mjs and drops it from
      // .output/server/node_modules. Every PDF parse then dies with
      // "Setting up fake worker failed: Cannot find module .../pdf.worker.mjs",
      // which reaches recruiters as unreadable CVs and 0% AI scores.
      //
      // externals.traceInclude can't fix this: Nitro feeds the entry back
      // through Rollup's resolver, which returns the bare specifier, and then
      // hands that to nodeFileTrace as a root-relative path. So place the file
      // ourselves, next to the pdf.mjs that imports it.
      async compiled(nitro) {
        if (nitro.options.dev) return;
        const destination = join(
          nitro.options.output.serverDir,
          "node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs",
        );
        await mkdir(dirname(destination), { recursive: true });
        await copyFile(pdfjsWorkerPath, destination);
      },
    },
    scheduledTasks: {
      // Every minute: drain the recruiter notification outbox (instant cadence).
      "* * * * *": ["notification-dispatch"],
      // Daily at 03:00 UTC. External cron remains supported for platforms that
      // suspend long-running processes or do not execute Nitro task timers.
      "0 3 * * *": ["retention-cleanup"],
      // Daily at 08:00 UTC: roll up digest-cadence notifications per recipient.
      "0 8 * * *": ["notification-digest"],
    },
    routeRules: {
      "/**": {
        headers: {
          "X-Content-Type-Options": "nosniff",
          "X-Frame-Options": "DENY",
          "Referrer-Policy": "strict-origin-when-cross-origin",
          "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
          "Strict-Transport-Security":
            "max-age=63072000; includeSubDomains; preload",
          // Content-Security-Policy is set dynamically with a per-request
          // nonce in server/middleware/csp.ts — do NOT add a static CSP here
          // as it would override the nonce and break the XSS protection.
          // Block indexing for all non-public routes by default;
          // overridden below for /jobs/** which should be indexable.
          "X-Robots-Tag": "noindex, nofollow",
        },
      },
      // Public marketing pages — allow indexing
      "/pricing": {
        headers: {
          "X-Robots-Tag": "index, follow",
        },
      },
      "/jobs/**": {
        headers: {
          "X-Robots-Tag": "index, follow",
        },
      },
      "/jobs": {
        headers: {
          "X-Robots-Tag": "index, follow",
        },
      },
      // Branded per-org career pages — allow indexing (disabled/missing pages
      // set a page-level noindex meta tag to opt back out).
      "/career/**": {
        headers: {
          "X-Robots-Tag": "index, follow",
        },
      },
      // Localized public marketing pages — allow indexing
      ...localizedPublicRobotsRules,
      // Allow same-origin framing for inline PDF preview in the sidebar iframe
      "/api/documents/*/preview": {
        headers: {
          "X-Frame-Options": "SAMEORIGIN",
          "Content-Security-Policy":
            "default-src 'none'; style-src 'unsafe-inline'",
        },
      },
    },
  },
});
