<script setup lang="ts">
import {
    Sun,
    Moon,
    Check,
    ChevronDown,
} from "lucide-vue-next";
import {
    BILLING_PLANS,
    getBillingPlan,
    type BillingPlan,
    type BillingTier,
} from "~~/shared/billing";
import type { BillingCadence } from "~/composables/useBillingCheckout";
const { isDark, toggle: toggleColorMode } = useColorMode();

const route = useRoute();

// ── Plan picker ───────────────────────────────────────────────────────────
// A visitor who picked a plan on the pricing page arrives here with the intent
// in the URL; on the sign-up page they can also pick or switch right here. The
// chosen plan/cadence lives in the URL query, so the downstream checkout reads
// the same source of truth and the half-filled form survives a query change.
const isSignUp = computed(() => route.path.includes("/auth/sign-up"));
const isSignIn = computed(() => route.path.includes("/auth/sign-in"));
const selectedIntent = computed(() => parseBillingCheckoutIntent(route.query));
const isFreeSelected = computed(() => hasFreePlanIntent(route.query));
const selectedCadence = computed<BillingCadence>(() =>
    parseBillingCadenceQuery(route.query),
);

// The currently-chosen tier (free + paid), or null when nothing is selected.
const currentPlanId = computed<BillingTier | null>(
    () =>
        selectedIntent.value?.planId ?? (isFreeSelected.value ? "free" : null),
);
const currentPaidPlan = computed(() =>
    selectedIntent.value
        ? (getBillingPlan(selectedIntent.value.planId) ?? null)
        : null,
);

// Show the picker on sign-up always (so anyone can choose), and elsewhere only
// when a plan intent is already present (e.g. returning to finish checkout).
const showPlanPicker = computed(
    () => isSignUp.value || currentPlanId.value !== null,
);

function priceLabel(plan: BillingPlan): string {
    if (selectedCadence.value === "annual" && plan.annualPrice != null) {
        return `$${Math.round(plan.annualPrice / 12).toLocaleString("en-US")}/mo`;
    }
    return `$${plan.monthlyPrice}/mo`;
}

type PlanOption = {
    id: BillingTier;
    name: string;
    tagline: string;
    price: string;
    featured: boolean;
};
const planOptions = computed<PlanOption[]>(() => [
    {
        id: "free",
        name: "Free trial",
        tagline: "Try one role — first AI shortlist free",
        price: "$0",
        featured: false,
    },
    ...BILLING_PLANS.map((p) => ({
        id: p.id,
        name: p.name,
        tagline: p.tagline,
        price: priceLabel(p),
        featured: p.id === "team",
    })),
]);

// Trigger summary shown on the closed picker.
const triggerName = computed(() => {
    if (currentPlanId.value === "free") return "Free trial";
    return currentPaidPlan.value?.name ?? "Choose a plan";
});
const triggerSub = computed(() => {
    if (currentPlanId.value === "free")
        return "Try one role — first AI shortlist free";
    return (
        currentPaidPlan.value?.tagline ??
        "Start with a free trial or pick a paid plan"
    );
});
const triggerPrice = computed(() => {
    if (currentPlanId.value === "free") return "$0";
    return currentPaidPlan.value ? priceLabel(currentPaidPlan.value) : "";
});

const planMenuOpen = ref(false);
const planMenuRef = ref<HTMLElement | null>(null);
function handlePlanClickOutside(event: MouseEvent) {
    if (
        planMenuRef.value &&
        !planMenuRef.value.contains(event.target as Node)
    ) {
        planMenuOpen.value = false;
    }
}
onMounted(() => document.addEventListener("mousedown", handlePlanClickOutside));
onUnmounted(() =>
    document.removeEventListener("mousedown", handlePlanClickOutside),
);

// Write the selection into the URL, preserving every other query param.
function applyQuery(patch: Record<string, string | undefined>) {
    const query: Record<string, unknown> = { ...route.query, ...patch };
    for (const key of Object.keys(query)) {
        if (query[key] === undefined) delete query[key];
    }
    navigateTo({ query: query as Record<string, string> });
}
function selectPlan(id: BillingTier) {
    if (id === "free") applyQuery({ plan: "free", billing: undefined });
    else applyQuery({ plan: id, billing: selectedCadence.value });
    planMenuOpen.value = false;
}
function setCadence(cadence: BillingCadence) {
    applyQuery({ billing: cadence });
}
</script>

<template>
    <div class="relative min-h-screen bg-surface-50 dark:bg-surface-950">
        <!-- Top-left controls -->
        <div class="absolute left-4 top-4 z-20 flex items-center gap-2">
            <ClientOnly>
                <button
                    class="inline-flex size-8 cursor-pointer items-center justify-center rounded-lg border-0 bg-transparent text-surface-500 transition-all duration-200 hover:bg-surface-100 hover:text-surface-700 dark:text-surface-400 dark:hover:bg-surface-800 dark:hover:text-surface-200"
                    :title="
                        isDark ? 'Switch to light mode' : 'Switch to dark mode'
                    "
                    @click="toggleColorMode"
                >
                    <Sun v-if="isDark" class="size-4" />
                    <Moon v-else class="size-4" />
                </button>
                <template #fallback>
                    <div class="size-8" aria-hidden="true" />
                </template>
            </ClientOnly>
            <LanguageSwitcher align="left" />
        </div>

        <!-- ── Brand panel (large screens) — pinned to the right edge so the form
         can sit dead-center of the screen while the branding stays on the
         side. Hidden below xl, where there isn't room for both. ── -->
        <aside
            v-if="!isSignUp"
            class="absolute inset-y-0 right-0 z-20 hidden w-[26rem] flex-col overflow-hidden border-l border-surface-200 bg-surface-100 p-12 xl:flex dark:border-transparent dark:bg-[#09090b]"
        >
            <!-- Logo mark -->
            <div class="relative flex items-center gap-3">
                <img
                    src="/eagle-mascot-logo.png"
                    alt=""
                    class="size-9 object-contain"
                />
                <span
                    class="text-lg font-semibold tracking-tight text-surface-900 dark:text-white"
                    >Reqcore</span
                >
            </div>

            <!-- Plan picker — a premium popover to choose or switch plan and cadence.
           Shown on sign-up, or anywhere a plan intent is already present. -->
            <div
                v-if="showPlanPicker && !isSignIn"
                ref="planMenuRef"
                class="relative mt-12"
            >
                <p
                    class="text-[12px] uppercase tracking-wide text-surface-400 dark:text-white/35"
                >
                    Your plan
                </p>

                <!-- Trigger -->
                <button
                    type="button"
                    class="mt-2 flex w-full items-center justify-between gap-3 rounded-xl border border-surface-200 bg-white px-3.5 py-3 text-left transition hover:border-surface-300 dark:border-white/[0.08] dark:bg-white/[0.03] dark:hover:border-white/20"
                    :aria-expanded="planMenuOpen"
                    @click="planMenuOpen = !planMenuOpen"
                >
                    <span class="min-w-0">
                        <span
                            class="block text-[14px] font-semibold text-surface-900 dark:text-white"
                            >{{ triggerName }}</span
                        >
                        <span
                            class="mt-0.5 block truncate text-[12px] text-surface-400 dark:text-white/40"
                            >{{ triggerSub }}</span
                        >
                    </span>
                    <span class="flex shrink-0 items-center gap-2">
                        <span
                            v-if="triggerPrice"
                            class="text-[13px] font-semibold text-surface-700 dark:text-white/80"
                            >{{ triggerPrice }}</span
                        >
                        <ChevronDown
                            class="size-4 text-surface-400 transition-transform duration-200"
                            :class="planMenuOpen && 'rotate-180'"
                        />
                    </span>
                </button>

                <!-- Popover -->
                <Transition
                    enter-active-class="transition duration-150 ease-out"
                    enter-from-class="opacity-0 -translate-y-1"
                    leave-active-class="transition duration-100 ease-in"
                    leave-to-class="opacity-0 -translate-y-1"
                >
                    <div
                        v-if="planMenuOpen"
                        class="absolute inset-x-0 z-30 mt-2 overflow-hidden rounded-xl border border-surface-200 bg-white shadow-xl ring-1 ring-black/[0.02] dark:border-white/[0.08] dark:bg-[#101014] dark:shadow-black/40"
                    >
                        <!-- Cadence toggle -->
                        <div
                            class="grid grid-cols-2 gap-1 border-b border-surface-100 p-1.5 dark:border-white/[0.06]"
                        >
                            <button
                                type="button"
                                class="rounded-md px-3 py-1.5 text-[12px] font-medium transition"
                                :class="
                                    selectedCadence === 'monthly'
                                        ? 'bg-surface-100 text-surface-900 dark:bg-white/[0.1] dark:text-white'
                                        : 'text-surface-500 hover:text-surface-800 dark:text-white/45 dark:hover:text-white'
                                "
                                @click="setCadence('monthly')"
                            >
                                Monthly
                            </button>
                            <button
                                type="button"
                                class="flex items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-[12px] font-medium transition"
                                :class="
                                    selectedCadence === 'annual'
                                        ? 'bg-surface-100 text-surface-900 dark:bg-white/[0.1] dark:text-white'
                                        : 'text-surface-500 hover:text-surface-800 dark:text-white/45 dark:hover:text-white'
                                "
                                @click="setCadence('annual')"
                            >
                                Yearly
                                <span
                                    class="rounded-full bg-emerald-500/15 px-1.5 py-px text-[10px] font-semibold text-emerald-600 dark:text-emerald-400"
                                    >2 months free</span
                                >
                            </button>
                        </div>

                        <!-- Plan options -->
                        <ul class="p-1.5">
                            <li v-for="opt in planOptions" :key="opt.id">
                                <button
                                    type="button"
                                    class="flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left transition hover:bg-surface-50 dark:hover:bg-white/[0.04]"
                                    :class="
                                        opt.id === currentPlanId &&
                                        'bg-surface-50 dark:bg-white/[0.04]'
                                    "
                                    @click="selectPlan(opt.id)"
                                >
                                    <span
                                        class="flex size-4 shrink-0 items-center justify-center"
                                    >
                                        <Check
                                            v-if="opt.id === currentPlanId"
                                            class="size-4 text-brand-500"
                                            :stroke-width="2.5"
                                        />
                                    </span>
                                    <span class="min-w-0 flex-1">
                                        <span class="flex items-center gap-2">
                                            <span
                                                class="text-[13.5px] font-semibold text-surface-900 dark:text-white"
                                                >{{ opt.name }}</span
                                            >
                                            <span
                                                v-if="opt.featured"
                                                class="rounded-full bg-brand-500/15 px-1.5 py-0.5 text-[10px] font-medium text-brand-600 dark:text-brand-300"
                                                >Popular</span
                                            >
                                        </span>
                                        <span
                                            class="block truncate text-[12px] text-surface-400 dark:text-white/40"
                                            >{{ opt.tagline }}</span
                                        >
                                    </span>
                                    <span
                                        class="shrink-0 text-[13px] font-semibold text-surface-700 dark:text-white/80"
                                        >{{ opt.price }}</span
                                    >
                                </button>
                            </li>
                        </ul>
                    </div>
                </Transition>

                <p
                    v-if="currentPaidPlan"
                    class="mt-2 text-[12px] text-surface-400 dark:text-white/35"
                >
                    Secure checkout after sign-up
                </p>
            </div>

            <p
                v-if="isSignIn || isSignUp"
                class="mt-auto text-sm text-surface-500 dark:text-white/40"
            >
                {{
                    isSignIn
                        ? "Need help signing in?"
                        : "Need help getting started?"
                }}
                <a
                    href="mailto:support@reqcore.com?subject=Reqcore%20account%20help"
                    class="font-medium text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
                    >Contact support</a
                >.
            </p>
        </aside>

        <!-- ── Form — centered on the full viewport, independent of the panel ── -->
        <div
            class="relative z-10 flex min-h-screen items-center justify-center overflow-y-auto px-4 py-12 sm:px-8"
        >
            <div class="w-full max-w-[420px]">
                <!-- Compact brand mark — shown when the side panel is hidden -->
                <div
                    class="mb-8 flex flex-col items-center gap-3 text-center xl:hidden"
                >
                    <img
                        src="/eagle-mascot-logo.png"
                        alt="Reqcore mascot"
                        class="size-12 object-contain"
                    />
                    <span
                        class="text-lg font-semibold tracking-tight text-surface-900 dark:text-surface-100"
                        >Reqcore</span
                    >
                </div>

                <slot />
            </div>
        </div>
    </div>
</template>
