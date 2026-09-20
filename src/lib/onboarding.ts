/**
 * The onboarding journey — pure step logic.
 *
 * The journey is derived from real tenant state (trade chosen, services saved,
 * compliance record complete, subscription active, contacts imported, campaign
 * created). Nothing is remembered in the browser, so the journey is always
 * honest, even on a new device, and it is identical for every tenant.
 */

export const ONBOARDING_STEP_IDS = [
  "trade",
  "website",
  "compliance",
  "subscribe",
  "import",
  "campaign",
] as const;

export type OnboardingStepId = (typeof ONBOARDING_STEP_IDS)[number];

export type OnboardingFacts = {
  tradeChosen: boolean;
  serviceCount: number;
  complianceComplete: boolean;
  subscriptionActive: boolean;
  importedContacts: number;
  campaignsCreated: number;
};

export type OnboardingStep = {
  id: OnboardingStepId;
  title: string;
  detail: string;
  /** Where the owner goes to do this step. */
  path: string;
  search?: { step: "trade" | "website" };
  hash?: string;
  done: boolean;
  /** True for the one step the owner should do next. */
  current: boolean;
  /** Set when an earlier step has to be finished first. */
  blockedBy: OnboardingStepId | null;
};

const STEP_COPY: Record<OnboardingStepId, { title: string; detail: string; path: string }> = {
  trade: {
    title: "Tell us your trade",
    detail: "So your services, wording and follow-up timing start out right.",
    path: "/setup",
    search: { step: "trade" },
  },
  website: {
    title: "Add your website",
    detail: "We read it and fill in your services, prices and hours for you to approve.",
    path: "/setup",
    search: { step: "website" },
  },
  compliance: {
    title: "Your business details",
    detail: "Legal name, ABN, address and contact — needed before we can get you a number.",
    path: "/settings/messaging",
  },
  subscribe: {
    title: "Start your subscription",
    detail: "This opens importing, campaigns and messaging.",
    path: "/settings/billing",
  },
  import: {
    title: "Add your old customers",
    detail: "Upload your contact list and we save them to your inbox.",
    path: "/import",
  },
  campaign: {
    title: "Run your first campaign",
    detail: "Pick the customers yourself, or ask Cowork to do it for you.",
    path: "/leads",
    hash: "reactivation",
  },
};

function isStepDone(id: OnboardingStepId, facts: OnboardingFacts): boolean {
  switch (id) {
    case "trade":
      return facts.tradeChosen;
    case "website":
      return facts.serviceCount > 0;
    case "compliance":
      return facts.complianceComplete;
    case "subscribe":
      return facts.subscriptionActive;
    case "import":
      return facts.importedContacts > 0;
    case "campaign":
      return facts.campaignsCreated > 0;
  }
}

/**
 * The paywall: setup and the website read are free, everything after the
 * subscription step waits for payment. This mirrors the server-side gate — it
 * is here so the screen can explain the wait instead of showing a dead button.
 */
export function isBehindPaywall(id: OnboardingStepId): boolean {
  return id === "import" || id === "campaign";
}

export function buildOnboardingSteps(facts: OnboardingFacts): OnboardingStep[] {
  const steps = ONBOARDING_STEP_IDS.map((id) => ({
    id,
    ...STEP_COPY[id],
    done: isStepDone(id, facts),
    current: false,
    blockedBy: isBehindPaywall(id) && !facts.subscriptionActive ? ("subscribe" as const) : null,
  }));
  const next = steps.find((step) => !step.done && !step.blockedBy);
  if (next) next.current = true;
  return steps;
}

export function onboardingComplete(facts: OnboardingFacts): boolean {
  return ONBOARDING_STEP_IDS.every((id) => isStepDone(id, facts));
}

export function onboardingProgressLabel(steps: OnboardingStep[]): string {
  const done = steps.filter((step) => step.done).length;
  return `${done} of ${steps.length} done`;
}
