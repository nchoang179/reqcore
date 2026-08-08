/**
 * Google Ads tag (gtag.js) — conversion tracking for the PPC campaign.
 *
 * Only loads when NUXT_PUBLIC_GOOGLE_ADS_ID is set, which is Reqcore Cloud
 * only. Self-hosted deployments get no Google tag and no outbound request.
 *
 * Consent Mode v2 defaults are written before gtag.js loads, so ad_storage
 * starts 'denied' and only upgrades if the visitor accepts on the banner.
 * The consent cookie is shared across *.reqcore.com, so a visitor who
 * accepted on the marketing site arrives here already granted.
 *
 * Conversions themselves are fired from useGoogleAdsConversion().
 */
import { CONSENT_COOKIE_NAME } from "~/composables/useAnalyticsConsent";

declare global {
    interface Window {
        dataLayer: Record<string, unknown>[];
        gtag: (...args: unknown[]) => void;
    }
}

export default defineNuxtPlugin((nuxtApp) => {
    const config = useRuntimeConfig().public as Record<string, string>;
    const googleAdsId = config.googleAdsId ?? "";
    const marketingUrl = config.marketingUrl ?? "";
    if (!googleAdsId) return;

    const consentCookie = useCookie<string | null>(CONSENT_COOKIE_NAME);

    // Consent Mode v2 defaults — must execute before gtag.js loads so the tag
    // reads the correct initial state. Mirrors reqcore-web's consentMode.ts.
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

    // Cross-domain linking back to the marketing site — accept_incoming reads
    // the _gl parameter reqcore.com puts on outbound links, so the ad click id
    // survives the hop to this host and conversions get attributed to it.
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

        const script = document.createElement("script");
        script.async = true;
        script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(googleAdsId)}`;
        document.head.appendChild(script);

        window.gtag("js", new Date());
        window.gtag("config", googleAdsId, {
            linker: { domains: linkerDomains, accept_incoming: true },
        });
    }

    // Load eagerly on auth/onboarding routes — a conversion can fire within
    // seconds there and gtag must already be present. Everywhere else it can
    // wait for idle time.
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

    const router = useRouter();
    router.beforeEach((to) => {
        if (isConversionRoute(to.path)) loadGtag();
    });

    // Mirror consent changes made in this app onto the Ads tag.
    watchEffect(() => {
        const state = consentCookie.value === "granted" ? "granted" : "denied";
        window.gtag?.("consent", "update", {
            ad_storage: state,
            ad_user_data: state,
            ad_personalization: state,
            analytics_storage: state,
        });
    });
});
