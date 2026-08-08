/**
 * Reports paid subscriptions to Google Ads.
 *
 * Stripe Checkout returns the customer to `?checkout=success` on our own
 * domain, so the conversion can be reported client-side — the Ads click id
 * lives in a first-party cookie and survives the round trip to Stripe.
 *
 * The query parameter alone is NOT sufficient evidence of a purchase:
 * useBillingCheckout points the Stripe Customer Portal `returnUrl` at the same
 * URL, so a customer who opens the portal and changes nothing lands here too.
 * We therefore confirm against /api/billing/status and only report when the
 * org actually holds an active paid subscription.
 *
 * Reported subscriptions are remembered locally so a reload of the success URL
 * does not fire twice; the Ads-side transaction_id gives the same protection
 * server-side, across devices.
 */
import { getBillingPlan } from "~~/shared/billing";

/** Statuses that mean the org currently holds plan entitlements. */
const ACTIVE_STATUSES = new Set(["active", "trialing", "past_due"]);

const REPORTED_KEY = "reqcore:ads-subscription-reported";

type BillingStatusResponse = {
    subscription: null | {
        plan: string;
        stripeSubscriptionId: string | null;
        status: string;
        billingInterval: string | null;
    };
};

function readReported(): string[] {
    try {
        const raw = window.localStorage.getItem(REPORTED_KEY);
        return raw ? (JSON.parse(raw) as string[]) : [];
    } catch {
        return [];
    }
}

function markReported(token: string) {
    try {
        const next = [...readReported(), token].slice(-20);
        window.localStorage.setItem(REPORTED_KEY, JSON.stringify(next));
    } catch {
        // Storage unavailable (private mode, quota) — the Ads-side
        // transaction_id still dedupes.
    }
}

export default defineNuxtPlugin(() => {
    const { trackConversion } = useGoogleAdsConversion();

    async function reportIfPurchased() {
        let status: BillingStatusResponse;
        try {
            status = await $fetch<BillingStatusResponse>("/api/billing/status");
        } catch {
            return;
        }

        const sub = status.subscription;
        if (!sub || !ACTIVE_STATUSES.has(sub.status)) return;

        const plan = getBillingPlan(sub.plan);
        if (!plan) return;

        // Key on plan and interval as well as subscription id, so an upgrade
        // from Solo to Team on the same Stripe subscription is still counted.
        const token = `${sub.stripeSubscriptionId ?? sub.plan}:${sub.plan}:${sub.billingInterval ?? "monthly"}`;
        if (readReported().includes(token)) return;

        const isAnnual = sub.billingInterval === "annual";
        const value =
            isAnnual && plan.annualPrice !== null
                ? plan.annualPrice
                : plan.monthlyPrice;

        trackConversion("subscription", {
            value,
            // BILLING_PLANS carries display prices in USD; Ads converts to the
            // account currency itself.
            currency: "USD",
            transactionId: token,
        });
        markReported(token);
    }

    const router = useRouter();
    router.afterEach((to) => {
        if (to.query.checkout !== "success") return;
        // Give the Stripe webhook a moment to land before asking for status;
        // the endpoint reconciles from Stripe directly, so this is belt and
        // braces rather than a hard dependency.
        setTimeout(reportIfPurchased, 1500);
    });
});
