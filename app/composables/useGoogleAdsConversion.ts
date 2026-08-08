/**
 * Fires Google Ads conversions for the PPC campaign.
 *
 * No-ops entirely unless NUXT_PUBLIC_GOOGLE_ADS_ID and the relevant label are
 * configured (Reqcore Cloud only — self-hosted deployments never call out).
 *
 * Conversion labels come from Google Ads → Goals → Conversions → the specific
 * conversion action → "Tag setup" → the `send_to` value after the slash.
 * They are per-action, not per-account, so each event needs its own.
 */
type ConversionEvent = "signup" | "org_created";

/**
 * Google Ads labels are short base64-ish tokens (e.g. 'AbC-D_efGhIjKlMn').
 * Anything else — most often a copied placeholder like '<label>' or the
 * AW- account id pasted by mistake — is treated as unconfigured, so a
 * misconfigured deploy sends nothing rather than junk Ads never accepts.
 */
function isValidLabel(label: string | undefined): label is string {
    if (!label) return false;
    if (label.startsWith("AW-")) return false;
    return /^[\w-]{6,}$/.test(label);
}

export function useGoogleAdsConversion() {
    const config = useRuntimeConfig().public as Record<string, string>;

    const labels: Record<ConversionEvent, string | undefined> = {
        signup: config.googleAdsSignupLabel,
        org_created: config.googleAdsOrgCreatedLabel,
    };

    /**
     * Report a conversion. Safe to call unconditionally — returns silently if
     * Ads is not configured, the label is missing, or gtag has not loaded.
     *
     * Note on transport: gtag sends conversion pings via navigator.sendBeacon
     * where available, so a call made immediately before a full-page navigation
     * (e.g. org creation, which does window.location.href) still goes out.
     */
    function trackConversion(
        event: ConversionEvent,
        params?: { value?: number; currency?: string; transactionId?: string },
    ) {
        if (!import.meta.client) return;

        const adsId = config.googleAdsId;
        const label = labels[event];
        if (!adsId || !isValidLabel(label)) return;
        if (typeof window.gtag !== "function") return;

        window.gtag("event", "conversion", {
            send_to: `${adsId}/${label}`,
            // Ads dedupes on transaction_id, so a user who reloads a success
            // page or double-submits is only counted once.
            ...(params?.transactionId
                ? { transaction_id: params.transactionId }
                : {}),
            ...(params?.value !== undefined ? { value: params.value } : {}),
            ...(params?.currency ? { currency: params.currency } : {}),
        });
    }

    return { trackConversion };
}
