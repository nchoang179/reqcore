/**
 * Redirect app.reqcore.com's duplicate marketing pages to their canonical
 * destinations.
 *
 * The home page always belongs on reqcore.com. Pricing is session-aware:
 * authenticated users go straight to billing in the app, while visitors see
 * the canonical pricing page on reqcore.com. Only these two route families
 * redirect — everything else stays on app.reqcore.com.
 */
const APP_HOSTS = new Set(["app.reqcore.com"]);
const CANONICAL_ORIGIN = "https://reqcore.com";
const NON_DEFAULT_LOCALES = ["es", "fr", "de", "nb", "vi"];

const HOME_PATHS = new Set([
  "/",
  ...NON_DEFAULT_LOCALES.map((locale) => `/${locale}`),
]);

const PRICING_PATHS = new Set([
  "/pricing",
  ...NON_DEFAULT_LOCALES.map((locale) => `/${locale}/pricing`),
]);

export default defineEventHandler(async (event) => {
  const host = getRequestHeader(event, "host")?.split(":")[0]?.toLowerCase();
  if (!host || !APP_HOSTS.has(host)) return;

  const url = getRequestURL(event);
  if (HOME_PATHS.has(url.pathname)) {
    const target = `${CANONICAL_ORIGIN}${url.pathname}${url.search}`;
    return sendRedirect(event, target, 301);
  }

  if (!PRICING_PATHS.has(url.pathname)) return;

  // This response varies by the Better Auth session cookie, so it must never
  // be stored as a shared/permanent redirect by a browser or CDN.
  setResponseHeaders(event, {
    "Cache-Control": "private, no-store",
    Vary: "Cookie",
  });

  const session = await auth.api.getSession({ headers: event.headers });
  const locale = NON_DEFAULT_LOCALES.find((code) =>
    url.pathname.startsWith(`/${code}/`),
  );
  const target = session
    ? `${locale ? `/${locale}` : ""}/dashboard/settings/billing${url.search}`
    : `${CANONICAL_ORIGIN}${url.pathname}${url.search}`;

  return sendRedirect(event, target, 302);
});
