import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { organization, genericOAuth } from "better-auth/plugins";
import { sso } from "@better-auth/sso";
import { stripe as stripePlugin } from "@better-auth/stripe";
import Stripe from "stripe";
import { and, eq, gte, sql } from "drizzle-orm";
import { APIError } from "better-auth/api";
import { ac, owner, admin, member } from "~~/shared/permissions";
import { isBillingActionAllowed } from "~~/shared/billing";
import { sendOrgInvitationEmail, sendPasswordResetEmail, sendVerificationEmail } from "./email";
import { deferredEmailVerification } from "./email-verification";
import { isDisposableEmailDomain } from "./disposable-email-domains";
import { OUTBOUND_LIMITS } from "~~/shared/abuse-limits";
import { getMissingStripeBillingVars, isStripeBillingConfigured, isRailwayPreviewEnvironment } from "./env";
import { buildStripePlans } from "./billing/stripe-plans";
import { isDemoOrgId, isDemoAccountEmail } from "./demoOrg";
import { LIFECYCLE_EVENTS, emitLifecycleEventInBackground } from "./lifecycle/events";
import * as schema from "../database/schema";

/**
 * Reads the Endorsely affiliate referral id off the incoming request cookies.
 *
 * The referral is captured on the marketing site (reqcore.com), where the
 * Endorsely tracking script runs, and mirrored into an `endorsely_referral`
 * cookie scoped to the shared `.reqcore.com` domain so it survives the hop to
 * the app subdomain. We forward it into Stripe Checkout session metadata so
 * Endorsely can attribute the sale (it reads the value off the
 * `checkout.session.completed` webhook). Endorsely referral ids are UUIDs; we
 * validate the shape to avoid writing arbitrary cookie content into Stripe.
 */
function readEndorselyReferral(request?: Request): string | undefined {
  const cookieHeader = request?.headers?.get("cookie");
  if (!cookieHeader) return undefined;
  for (const part of cookieHeader.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() !== "endorsely_referral") continue;
    const value = decodeURIComponent(part.slice(eq + 1).trim());
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      value,
    )
      ? value
      : undefined;
  }
  return undefined;
}

/**
 * Authorization guard for org-scoped billing. Subscriptions are referenced by
 * organization id; this verifies the acting user actually belongs to that org
 * (and, for any mutating action, is an owner/admin). Without this, a user could
 * start/cancel checkout for an organization they don't control.
 */
async function authorizeOrgBilling({
  userId,
  referenceId,
  action,
}: {
  userId: string;
  referenceId: string;
  action: string;
}): Promise<boolean> {
  // The public demo must never buy, change, cancel, or open a billing portal
  // for a real subscription. Reading the plan is fine; every mutating billing
  // action is hard-blocked. This runs even for /api/auth/** checkout calls,
  // which the demo-guard middleware intentionally skips.
  //
  // We block on BOTH signals because they have different coverage:
  //   - the demo *org* (isDemoOrgId) — only resolves when DEMO_ORG_SLUG /
  //     a Railway preview is configured, so it can be inactive in dev.
  //   - the demo *account email* (demo@reqcore.com) — always identifies the
  //     public demo user regardless of env config or which org is active.
  if (action !== "list-subscription") {
    const [actingUser] = await db
      .select({ email: schema.user.email })
      .from(schema.user)
      .where(eq(schema.user.id, userId))
      .limit(1);

    if (isDemoAccountEmail(actingUser?.email) || (await isDemoOrgId(referenceId))) {
      return false;
    }
  }

  const [membership] = await db
    .select({ role: schema.member.role })
    .from(schema.member)
    .where(
      and(
        eq(schema.member.userId, userId),
        eq(schema.member.organizationId, referenceId),
      ),
    )
    .limit(1);

  // Decision (member? reading vs. mutating) lives in a pure, unit-tested helper.
  return isBillingActionAllowed(membership?.role, action);
}

type Auth = ReturnType<typeof betterAuth>;
let _auth: Auth | undefined;

// ── SSRF blocklist ────────────────────────────────────────────────────────────
// Prevent org admins from using SSO provider registration to probe the
// internal network or cloud metadata services (OWASP A10 - SSRF).
const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "169.254.169.254",          // AWS / Azure / DigitalOcean IMDS
  "metadata.google.internal", // GCP IMDS
  "metadata.internal",
  "instance-data",            // older cloud-init
])

/**
 * Returns true if the hostname resolves to a private, loopback, link-local,
 * or well-known cloud metadata address that must not be contacted server-side.
 */
function isBlockedHost(urlString: string): boolean {
  let hostname: string
  try {
    hostname = new URL(urlString).hostname.toLowerCase()
  } catch {
    return true // malformed URL → block
  }
  if (BLOCKED_HOSTNAMES.has(hostname)) return true

  // IPv4 private / loopback ranges
  const ipv4 = hostname.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (ipv4) {
    const [a, b] = [Number(ipv4[1]), Number(ipv4[2])]
    if (a === 127) return true                          // 127.0.0.0/8  loopback
    if (a === 0) return true                            // 0.0.0.0/8
    if (a === 10) return true                           // 10.0.0.0/8   RFC 1918
    if (a === 172 && b >= 16 && b <= 31) return true   // 172.16.0.0/12 RFC 1918
    if (a === 192 && b === 168) return true             // 192.168.0.0/16 RFC 1918
    if (a === 100 && b >= 64 && b <= 127) return true  // 100.64.0.0/10 CGNAT
    if (a === 169 && b === 254) return true             // 169.254.0.0/16 link-local
  }

  // IPv6 loopback and link-local
  if (hostname === "::1") return true
  if (hostname.startsWith("fe80:") || hostname.startsWith("[fe80:")) return true

  return false
}

/**
 * Fetch an OIDC discovery document and inject every endpoint origin into
 * better-auth's live trusted-origins list so the SSO plugin trusts them
 * during provider registration.
 *
 * Why: better-auth resolves `trustedOrigins` once at init and caches the
 * result as a plain array. The SSO plugin then validates every URL in the
 * discovery document (discovery endpoint, token_endpoint, jwks_uri, etc.)
 * against that cached array. IdPs like Google use multiple domains
 * (accounts.google.com vs oauth2.googleapis.com), so we must discover
 * those origins and inject them into the live array before registration.
 *
 * Must be called **before** `auth.api.registerSSOProvider()`.
 */
export async function prefetchOidcEndpointOrigins(issuerUrl: string): Promise<void> {
  // SSRF guard — reject internal/private addresses before any network call
  if (isBlockedHost(issuerUrl)) {
    throw createError({
      statusCode: 422,
      statusMessage: "Issuer URL must not target internal or private network addresses.",
    });
  }

  const discoveryUrl = issuerUrl.replace(/\/+$/, "") + "/.well-known/openid-configuration";
  const res = await $fetch<Record<string, unknown>>(discoveryUrl, {
    timeout: 10_000,
  });

  // Collect origins from all endpoint fields + the issuer itself
  const newOrigins = new Set<string>();
  try { newOrigins.add(new URL(issuerUrl).origin); } catch {}

  const endpointKeys = [
    "authorization_endpoint",
    "token_endpoint",
    "userinfo_endpoint",
    "revocation_endpoint",
    "introspection_endpoint",
    "end_session_endpoint",
    "jwks_uri",
  ];
  for (const key of endpointKeys) {
    const value = res[key];
    if (typeof value === "string") {
      try { newOrigins.add(new URL(value).origin); } catch {}
    }
  }

  // Push directly into better-auth's live trustedOrigins array so
  // isTrustedOrigin() sees them immediately (it reads this.trustedOrigins).
  const ctx = await (auth as any).$context;
  const existing = new Set(ctx.trustedOrigins as string[]);
  for (const origin of newOrigins) {
    if (!existing.has(origin)) {
      (ctx.trustedOrigins as string[]).push(origin);
    }
  }
}

/**
 * Resolve trusted origins for CSRF checks and OIDC discovery.
 *
 * Combines:
 *  1. App origins (base URL, configured origins, dev defaults)
 *  2. Already-registered SSO provider issuers from the database
 *
 * Additional IdP endpoint origins are injected at runtime by
 * `prefetchOidcEndpointOrigins()` directly into the auth context.
 * For edge cases, add origins to the BETTER_AUTH_TRUSTED_ORIGINS env var.
 */
function resolveTrustedOrigins(baseUrl: string): (request?: Request) => Promise<string[]> {
  const configuredOrigins = env.BETTER_AUTH_TRUSTED_ORIGINS;
  const baseOrigin = new URL(baseUrl);
  const isLocalBase =
    baseOrigin.hostname === "localhost" || baseOrigin.hostname === "127.0.0.1";
  const defaultDevOrigins =
    import.meta.dev || isLocalBase
      ? [
          "http://localhost:3000",
          "http://localhost:3001",
          "http://localhost:3002",
          "http://localhost:3333",
          "http://127.0.0.1:3000",
          "http://127.0.0.1:3001",
          "http://127.0.0.1:3002",
          "http://127.0.0.1:3333",
        ]
      : [];

  const staticOrigins = Array.from(
    new Set([baseOrigin.origin, ...configuredOrigins, ...defaultDevOrigins]),
  );

  return async () => {
    const allOrigins = [...staticOrigins];

    // Load already-registered SSO provider issuers from the database
    try {
      const providers = await db
        .select({ issuer: schema.ssoProvider.issuer })
        .from(schema.ssoProvider);

      for (const p of providers) {
        try { allOrigins.push(new URL(p.issuer).origin); } catch {}
      }
    } catch {
      // Table may not exist yet (pre-migration)
    }

    return Array.from(new Set(allOrigins));
  };
}

/**
 * True when we're in a Railway PR environment and the configured
 * BETTER_AUTH_URL points somewhere other than this deployment's own domain —
 * i.e. it was cloned from the base environment and is stale.
 */
export function isStaleInheritedPreviewUrl(
  explicitUrl: string,
  railwayDomain: string | undefined,
): boolean {
  if (!railwayDomain) return false;

  // RAILWAY_GIT_PR_NUMBER is injected only in PR environments, so it's a far
  // more reliable signal than the environment name — Railway names PR
  // environments after the branch in some project configurations, and a branch
  // like "fix/reply-address" would not match any name heuristic.
  const isPreview =
    !!env.RAILWAY_GIT_PR_NUMBER ||
    isRailwayPreviewEnvironment(env.RAILWAY_ENVIRONMENT_NAME);
  if (!isPreview) return false;

  const domain = railwayDomain.replace(/^https?:\/\//, "").toLowerCase();

  let explicitHost: string;
  try {
    explicitHost = new URL(explicitUrl).host.toLowerCase();
  } catch {
    // Unparseable value can't be trusted as this deployment's URL.
    return true;
  }

  if (explicitHost === domain) return false;

  console.warn(
    `[Reqcore] Ignoring inherited BETTER_AUTH_URL (${explicitHost}) in preview ` +
      `environment "${env.RAILWAY_ENVIRONMENT_NAME}"; using ${domain} instead.`,
  );
  return true;
}

function resolveBetterAuthUrl(): string {
  const explicitUrl = env.BETTER_AUTH_URL?.trim();
  const railwayDomain = env.RAILWAY_PUBLIC_DOMAIN?.trim();

  // Explicit URL always wins (custom domain, local dev, etc.) — except in a
  // Railway PR environment, which inherits the base environment's variables.
  // There the inherited BETTER_AUTH_URL points at production, so the PR
  // deployment's own domain is the only correct answer.
  if (explicitUrl && !isStaleInheritedPreviewUrl(explicitUrl, railwayDomain)) {
    return explicitUrl;
  }

  // Derive from Railway's auto-injected public domain (works for all environments)
  if (railwayDomain) {
    // Railway sets this as bare domain (e.g. "app.up.railway.app"), never with protocol
    const domain = railwayDomain.replace(/^https?:\/\//, "");
    const url = `https://${domain}`;
    console.info(
      `[Reqcore] Using Railway public-domain BETTER_AUTH_URL: ${url}`,
    );
    return url;
  }

  throw new Error(
    "BETTER_AUTH_URL is required. Either set it explicitly or generate a public domain in Railway.\n" +
      "Railway users: go to Settings → Networking → Generate Domain, then redeploy.",
  );
}

/**
 * Lazily create the Better Auth instance on first access.
 * Prevents build-time prerendering from crashing when auth env vars
 * aren't available (Railway injects env vars only at deploy time).
 */
function getAuth(): Auth {
  if (!_auth) {
    const baseURL = resolveBetterAuthUrl();

    const stripeBillingConfigured = isStripeBillingConfigured(env);
    const missingStripeBillingVars = getMissingStripeBillingVars(env);

    if (missingStripeBillingVars.length > 0) {
      console.warn(
        `[Reqcore] Stripe billing disabled: missing ${missingStripeBillingVars.join(", ")}. ` +
          "Set all Stripe billing variables to enable checkout, or unset the partial Stripe variables.",
      );
    }

    _auth = betterAuth({
      baseURL,
      trustedOrigins: resolveTrustedOrigins(baseURL),
      database: drizzleAdapter(db, {
        provider: "pg",
        schema,
      }),
      secret: env.BETTER_AUTH_SECRET,

      // ── Session Hardening ────────────────────────────────────
      // Explicit session duration for an ATS handling sensitive hiring data.
      // Default Better Auth values (7 days / 1 day) are too permissive.
      session: {
        expiresIn: 60 * 60 * 24, // 24 hours
        updateAge: 60 * 60,      // Refresh session every 1 hour
      },

      emailAndPassword: {
        enabled: true,
        // Signup creates a session immediately. Mailbox ownership is enforced
        // later, at each user-triggered outbound email boundary.
        requireEmailVerification: deferredEmailVerification.requireBeforeSignIn,
        // Server-side password policy — prevents bypass via direct API calls.
        // Client-side validation (sign-up.vue) is UX only; this is the enforcement.
        minPasswordLength: 8,
        maxPasswordLength: 128,
        // Password reset via email.
        async sendResetPassword({ user, url, token }, request) {
          void sendPasswordResetEmail({ user, url, token });
        },
      },

      // ── Email Verification ───────────────────────────────────
      // Delivers the verification link (template lives in email.ts).
      // Better Auth sends this in the background while signup continues into
      // onboarding. The dashboard keeps a resend action available until the
      // mailbox is verified.
      emailVerification: {
        sendOnSignUp: deferredEmailVerification.sendOnSignUp,
        autoSignInAfterVerification: true,
        async sendVerificationEmail({ user, url, token }) {
          void sendVerificationEmail({ user, url, token });
        },
      },

      // ── Signup Abuse Guard ───────────────────────────────────
      // Reject disposable/throwaway email domains before an account is
      // created. Runs for every signup path (email/password, social,
      // OIDC) because they all create a user row. This removes the
      // cheap-identity supply that makes email-relay abuse economical.
      databaseHooks: {
        user: {
          create: {
            before: async (userToCreate) => {
              if (isDisposableEmailDomain(userToCreate.email)) {
                throw new APIError("BAD_REQUEST", {
                  message:
                    "Please sign up with a permanent email address. Disposable or temporary email domains aren't allowed.",
                });
              }
              return { data: userToCreate };
            },
          },
        },
      },

      // ── OAuth Token Encryption at Rest ──────────────────────
      // Better Auth's built-in AES encryption for OAuth tokens (access, refresh, id).
      // Handles both encryption on write and automatic decryption on read,
      // using BETTER_AUTH_SECRET as the encryption key.
      account: {
        encryptOAuthTokens: true,
        // Social sign-in with an email that already has an account links to
        // that account instead of failing with account_not_linked. Local
        // email verification is not required for the link: this app defers
        // verification (deferredEmailVerification), so most local accounts
        // are unverified, and the social provider already vouches for the
        // email (Google is a trusted provider asserting email_verified).
        accountLinking: { enabled: true, requireLocalEmailVerified: false },
      },

      // ── Rate Limiting (built-in, database-backed) ──────────
      // Uses DB storage so limits persist across restarts and share
      // state across instances (horizontal scaling).
      // Complements the external IP-based rate limiter in api-rate-limit.ts
      // with account-level throttling for auth-sensitive endpoints.
      // Disabled in CI/test (GITHUB_ACTIONS or NODE_ENV !== 'production')
      // to prevent E2E test flakiness.
      rateLimit: {
        enabled: process.env.NODE_ENV === "production"
          && !process.env.CI
          && !process.env.GITHUB_ACTIONS,
        window: 60,
        max: 100,        // 100 requests per minute per IP — stops bots, not humans
        storage: "database",
      },

      socialProviders: {
        // ── Social Sign-In (Google, GitHub, Microsoft) ────────────
        // Each provider is enabled only when its client ID + secret are set.
        ...(env.AUTH_GOOGLE_CLIENT_ID && env.AUTH_GOOGLE_CLIENT_SECRET
          ? {
              google: {
                clientId: env.AUTH_GOOGLE_CLIENT_ID,
                clientSecret: env.AUTH_GOOGLE_CLIENT_SECRET,
                prompt: "select_account",
              },
            }
          : {}),
        ...(env.AUTH_GITHUB_CLIENT_ID && env.AUTH_GITHUB_CLIENT_SECRET
          ? {
              github: {
                clientId: env.AUTH_GITHUB_CLIENT_ID,
                clientSecret: env.AUTH_GITHUB_CLIENT_SECRET,
              },
            }
          : {}),
        ...(env.AUTH_MICROSOFT_CLIENT_ID && env.AUTH_MICROSOFT_CLIENT_SECRET
          ? {
              microsoft: {
                clientId: env.AUTH_MICROSOFT_CLIENT_ID,
                clientSecret: env.AUTH_MICROSOFT_CLIENT_SECRET,
                tenantId: env.AUTH_MICROSOFT_TENANT_ID || "common",
                prompt: "select_account",
              },
            }
          : {}),
      },
      plugins: [
        organization({
          // ── Access Control ──────────────────────────────────────
          // Declarative RBAC — permissions defined once in shared/permissions.ts,
          // enforced on every API route via requirePermission().
          ac,
          roles: {
            owner,
            admin,
            member,
          },

          // ── Invitation Email ────────────────────────────────────
          // Required for Better Auth's built-in invitation flow.
          // Constructs a link the invitee clicks to accept.
          // Uses Resend when RESEND_API_KEY is configured, otherwise logs to console.
          async sendInvitationEmail(data) {
            const inviteLink = `${baseURL}/auth/accept-invitation/${data.id}`;
            await sendOrgInvitationEmail(data, inviteLink);
          },

          // ── Activation Funnel ───────────────────────────────────
          // Starts the "signed up, never opened a role" clock in Resend
          // Automations. This is the entry point of the funnel: the org row is
          // the first durable thing a signup produces, and every later step
          // (post a role, receive an application, run an analysis) hangs off it.
          //
          // Fires for every organization a user creates, not just their first.
          // A second org is a second workspace that can stall on its own, and
          // the automation keys on the org id in the payload. `isFirstOrg`
          // separates the two cases for the copy: someone opening their third
          // workspace already knows what Reqcore is, and greeting them as a new
          // signup is the kind of detail that makes automated mail obvious.
          organizationHooks: {
            afterCreateOrganization: async ({ organization: org, user }) => {
              // The new org's own member row already exists here, so the
              // first-ever workspace counts 1. Counting memberships rather than
              // orgs created means someone invited into a colleague's workspace
              // before starting their own is not treated as brand new either.
              const [membership] = await db
                .select({ count: sql<number>`count(*)::int` })
                .from(schema.member)
                .where(eq(schema.member.userId, user.id));

              emitLifecycleEventInBackground({
                event: LIFECYCLE_EVENTS.orgCreated,
                email: user.email,
                organizationId: org.id,
                payload: {
                  organizationName: org.name,
                  organizationSlug: org.slug,
                  firstName: user.name?.split(" ")[0] ?? null,
                  isFirstOrg: (membership?.count ?? 1) <= 1,
                },
              });
            },
          },

          // ── Abuse Hardening ─────────────────────────────────────
          // Cap organizations a single user can create. Blocks the
          // "spin up throwaway orgs to reset per-org quotas" pattern
          // seen in the invitation-spam incident. Joining more orgs via
          // invitation is unaffected — this only limits creation.
          organizationLimit: OUTBOUND_LIMITS.maxOrganizationsPerUser,

          // Two caps on invitations, enforced when each invite is created:
          //   1. Pending-per-org ceiling (the returned number) — Better
          //      Auth refuses the invite once that many are pending.
          //   2. Per-org hourly rate — we count invitations created in the
          //      last hour and refuse with 429 before returning the cap.
          // Together with send-time email verification and the 48h expiry,
          // this bounds how much mail one org can relay.
          invitationLimit: async ({ organization }) => {
            const windowStart = new Date(Date.now() - 60 * 60 * 1000);
            const [row] = await db
              .select({ count: sql<number>`count(*)::int` })
              .from(schema.invitation)
              .where(
                and(
                  eq(schema.invitation.organizationId, organization.id),
                  gte(schema.invitation.createdAt, windowStart),
                ),
              );
            if ((row?.count ?? 0) >= OUTBOUND_LIMITS.orgInvitesPerHour) {
              throw new APIError("TOO_MANY_REQUESTS", {
                message:
                  "This organization has sent too many invitations in the past hour. Please try again later.",
              });
            }
            return OUTBOUND_LIMITS.pendingInvitesPerOrg;
          },

          // Cancel stale invitations when a new one is sent to the same email.
          cancelPendingInvitationsOnReInvite: true,
          // 48 hours (default) — explicitly stated for auditability.
          invitationExpiresIn: 48 * 60 * 60,
        }),

        // ── OIDC SSO (Keycloak, Authentik, Authelia, Okta, Azure AD, etc.) ──
        // Activated only when all three OIDC env vars are set.
        // Uses better-auth's genericOAuth plugin with OIDC discovery.
        ...(env.OIDC_CLIENT_ID &&
        env.OIDC_CLIENT_SECRET &&
        env.OIDC_DISCOVERY_URL
          ? [
              genericOAuth({
                config: [
                  {
                    providerId: "oidc",
                    clientId: env.OIDC_CLIENT_ID,
                    clientSecret: env.OIDC_CLIENT_SECRET,
                    discoveryUrl: env.OIDC_DISCOVERY_URL,
                    scopes: ["openid", "email", "profile"],
                    pkce: true,
                    requireIssuerValidation: true,
                    async mapProfileToUser(profile) {
                      if (!profile.email) {
                        throw new Error(
                          "Email is required but was not provided by the identity provider. Ensure the 'email' scope is granted and the user has a verified email.",
                        );
                      }
                      return {
                        name:
                          profile.name ||
                          [profile.given_name, profile.family_name]
                            .filter(Boolean)
                            .join(" ") ||
                          profile.preferred_username ||
                          profile.email,
                        email: profile.email,
                        image: profile.picture,
                      };
                    },
                  },
                ],
              }),
            ]
          : []),

        // ── Enterprise SSO (per-organization OIDC, cloud-hosted) ─────────
        // Each organization can register their own Identity Provider (Okta,
        // Azure AD, Google Workspace, etc.). Users are auto-provisioned into
        // the linked organization on first SSO login.
        sso({
          // Auto-provision SSO users into the linked organization
          organizationProvisioning: {
            disabled: false,
            defaultRole: "member",
          },
          // Run provisioning on every login to keep profile data in sync
          provisionUserOnEveryLogin: true,
          provisionUser: async ({ user, userInfo }) => {
            // Sync name/image from IdP on each login
            if (userInfo.name || userInfo.image) {
              await db
                .update(schema.user)
                .set({
                  ...(userInfo.name ? { name: userInfo.name } : {}),
                  ...(userInfo.image ? { image: userInfo.image } : {}),
                  updatedAt: new Date(),
                })
                .where(eq(schema.user.id, user.id));
            }
          },
        }),

        // ── Stripe Billing (org-scoped subscriptions) ───────────────────
        // Enabled only when all Stripe billing env vars are set. Provides
        // Stripe-hosted Checkout, the Customer Portal, and signature-verified
        // webhooks at /api/auth/stripe/webhook (handled by the auth catch-all).
        ...(stripeBillingConfigured
          ? [
              stripePlugin({
                stripeClient: new Stripe(env.STRIPE_SECRET_KEY!),
                stripeWebhookSecret: env.STRIPE_WEBHOOK_SECRET!,
                // Customer is created lazily at first checkout, not on sign-up.
                createCustomerOnSignUp: false,
                // Bill the organization, not the individual member, so billing
                // survives membership changes.
                organization: { enabled: true },
                subscription: {
                  enabled: true,
                  plans: buildStripePlans(env),
                  // Let customers redeem Dashboard-managed promotion codes in
                  // Checkout, and forward the Endorsely affiliate referral (when
                  // present) so the sale is attributed to the referring affiliate.
                  getCheckoutSessionParams: (_data, request) => {
                    const endorselyReferral = readEndorselyReferral(request);
                    return {
                      params: {
                        allow_promotion_codes: true,
                        ...(endorselyReferral
                          ? { metadata: { endorsely_referral: endorselyReferral } }
                          : {}),
                      },
                    };
                  },
                  // Subscriptions are referenced by organization id; only
                  // members (owner/admin for mutations) of that org may act.
                  authorizeReference: async ({ user, referenceId, action }) =>
                    authorizeOrgBilling({
                      userId: user.id,
                      referenceId,
                      action,
                    }),
                },
              }),
            ]
          : []),
      ],
    }) as unknown as Auth;
  }
  return _auth!;
}

/**
 * Lazily-initialized Better Auth instance.
 * The auth configuration is created on first property access — not at import time.
 * This prevents build-time prerendering from failing when BETTER_AUTH_SECRET
 * and BETTER_AUTH_URL aren't available.
 */
export const auth: Auth = new Proxy({} as Auth, {
  get(_, prop) {
    const instance = getAuth();
    const value = (instance as Record<string | symbol, unknown>)[prop];
    return typeof value === "function"
      ? (value as Function).bind(instance)
      : value;
  },
});
