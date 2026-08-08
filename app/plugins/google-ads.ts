/**
 * Google Ads tag (gtag.js) — conversion tracking for the PPC campaign.
 *
 * Only loads when NUXT_PUBLIC_GOOGLE_ADS_ID is set, which is Reqcore Cloud
 * only. Self-hosted deployments get no Google tag and no outbound request.
 *
 * This plugin is universal, not client-only, on purpose: the consent snippet
 * must be rendered during SSR so server/plugins/csp-nonce.ts can stamp it with
 * the per-request nonce. Injected from the client it carries no nonce and the
 * CSP in server/middleware/csp.ts blocks it.
 *
 * Nothing here may throw. An ad blocker, a CSP change or a network failure can
 * all leave gtag.js unloaded, and this plugin runs on the sign-up page — a
 * crash here takes down the page it is trying to measure. Every entry point
 * goes through ensureGtag(), which falls back to a local dataLayer shim.
 *
 * Consent Mode v2 defaults keep ad_storage 'denied' until the visitor accepts.
 * The consent cookie is shared across *.reqcore.com, so someone who accepted
 * on the marketing site arrives here already granted.
 */
import { CONSENT_COOKIE_NAME } from "~/composables/useAnalyticsConsent";

declare global {
    interface Window {
        dataLayer: Record<string, unknown>[];
        gtag: (...args: unknown[]) => void;
    }
}

/**
 * Return a usable gtag function, creating the standard dataLayer shim if the
 * inline snippet never ran (CSP, ad blocker). Calls made through the shim
 * queue in dataLayer and are picked up if gtag.js loads later.
 */
function ensureGtag(): (...args: unknown[]) => void {
    window.dataLayer = window.dataLayer || [];
    if (typeof window.gtag !== "function") {
        window.gtag = function gtag() {
            // eslint-disable-next-line prefer-rest-params
            window.dataLayer.push(arguments as unknown as Record<string, unknown>);
        };
    }
    return window.gtag;
}

export default defineNuxtPlugin((nuxtApp) => {
    const config = useRuntimeConfig().public as Record<string, string>;
    const googleAdsId = config.googleAdsId ?? "";
    const marketingUrl = config.marketingUrl ?? "";
    if (!googleAdsId) return;

    // Rendered server-side so the CSP nonce is applied. Must execute before
    // gtag.js so the tag reads the correct initial consent state.
    useHead({
        script: [
            {
                innerHTML: `
window.dataLayer = window.dataLayer || [];
function gtag(){dataLayer.push(arguments);}
window.gtag = window.gtag || gtag;
gtag('consent', 'default', {
  analytics_storage: 'denied',
  ad_storage: 'denied',
  ad_user_data: 'denied',
  ad_personalization: 'denied',
  functionality_storage: 'granted',
  security_storage: 'granted',
  personalization_storage: 'denied',
  wait_for_update: 500
});
gtag('set', 'ads_data_redaction', true);
(function(){var c=document.cookie.split(';');for(var i=0;i<c.length;i++){var t=c[i].trim();if(t.indexOf('${CONSENT_COOKIE_NAME}=')===0&&t.slice('${CONSENT_COOKIE_NAME}='.length)==='granted'){gtag('consent','update',{analytics_storage:'granted',ad_storage:'granted',ad_user_data:'granted',ad_personalization:'granted',personalization_storage:'granted'});break;}}})();`,
                tagPosition: "head",
                key: "google-ads-consent-default",
            },
        ],
    });

    if (!import.meta.client) return;

    const consentCookie = useCookie<string | null>(CONSENT_COOKIE_NAME);

    // Cross-domain linking back to the marketing site — accept_incoming reads
    // the _gl parameter reqcore.com puts on outbound links, so the ad click id
    // survives the hop and conversions are attributed to it.
    const linkerDomains = [window.location.hostname];
    try {
        linkerDomains.push(new URL(marketingUrl).hostname.replace(/^www\./, ""));
    } catch {
        // marketingUrl misconfigured — same-host linking still works
    }

    let hasLoaded = false;

    function loadGtag() {
        if (hasLoaded) return;
        hasLoaded = true;

        const gtag = ensureGtag();

        const script = document.createElement("script");
        script.async = true;
        script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(googleAdsId)}`;
        // Blocked by CSP, an ad blocker or offline: the queued dataLayer calls
        // simply never send. Swallow it rather than surfacing an error.
        script.onerror = () => {};
        document.head.appendChild(script);

        gtag("js", new Date());
        gtag("config", googleAdsId, {
            linker: { domains: linkerDomains, accept_incoming: true },
        });
    }

    // Load eagerly on auth/onboarding routes — a conversion can fire within
    // seconds there and gtag must already be present. Elsewhere, wait for idle.
    const isConversionRoute = (path: string) =>
        path.includes("/auth/") || path.includes("/onboarding");

    nuxtApp.hook("app:mounted", () => {
        if (isConversionRoute(window.location.pathname)) {
            loadGtag();
            return;
        }
        window.requestIdleCallback
            ? window.requestIdleCallback(loadGtag, { timeout: 2500 })
            : window.setTimeout(loadGtag, 1500);
    });

    useRouter().beforeEach((to) => {
        if (isConversionRoute(to.path)) loadGtag();
    });

    // Mirror consent changes made in this app onto the Ads tag.
    watchEffect(() => {
        const state = consentCookie.value === "granted" ? "granted" : "denied";
        ensureGtag()("consent", "update", {
            ad_storage: state,
            ad_user_data: state,
            ad_personalization: state,
            analytics_storage: state,
        });
    });
});
