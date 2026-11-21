import type { Persona, PersonaContract, Query } from "./types";

// The MVP suite (SPEC.md): 3 personas × 3 queries.

// What "served this person" means, per persona. Rule contracts are checked offline (personaContracts.ts);
// judge contracts are scored by scripts/judge-personas.ts.
const FAMILY_CONTRACTS: PersonaContract[] = [
  {
    id: "family-seats-together",
    label: "Seat-together status is shown",
    appliesTo: ["search", "select", "seats"],
    kind: "judge",
    rule: "The family must sit together (two kids aged 6 and 9). The screen tells them whether the party can be seated together, or how to make sure of it.",
  },
  {
    id: "family-total-for-4",
    label: "Price shown is the total for all 4",
    appliesTo: ["search", "select", "pay"],
    kind: "rule",
    rule: "Every displayed fare price is the total for all 4 travelers (pricePerPax × 4 from the tool results), or says \"4 travelers\" right next to it.",
  },
  {
    id: "family-no-early-first",
    label: "Very early departures (before 07:00) aren't ranked first",
    appliesTo: ["search", "refine"],
    kind: "rule",
    rule: "The first fare shown does not depart before 07:00 when a later departure is also on screen.",
  },
];

const SOLO_CONTRACTS: PersonaContract[] = [
  {
    id: "solo-stops-labeled",
    label: "Stops are clearly labeled on every fare",
    appliesTo: ["search", "refine", "compare"],
    kind: "rule",
    rule: "Each displayed fare says nonstop or how many stops, next to it.",
  },
  {
    id: "solo-arrival-shown",
    label: "Arrival time is shown",
    appliesTo: ["search", "refine", "select"],
    kind: "rule",
    rule: "Each displayed fare shows when it lands, not only when it departs.",
  },
  {
    id: "solo-nonstop-first",
    label: "Nonstop ranks above 1-stop at similar price (±15%)",
    appliesTo: ["search", "refine"],
    kind: "rule",
    rule: "A fare with stops is not listed above a nonstop that costs at most 15% more.",
  },
];

const BUDGET_CONTRACTS: PersonaContract[] = [
  {
    id: "budget-true-total",
    label: "True total is shown (not just per-person)",
    appliesTo: ["search", "select", "pay"],
    kind: "rule",
    rule: "Every displayed fare shows the total for both travelers, not only the per-person price.",
  },
  {
    id: "budget-exclusions-stated",
    label: "What's excluded (bags/seats/fees) is stated before payment",
    appliesTo: ["select", "extras", "pay"],
    kind: "judge",
    rule: "Before they pay, the screen says what the fare does not include (checked bags, seat selection, fees), so there are no surprises.",
  },
  {
    id: "budget-no-preselected",
    label: "No bundles or add-ons pre-selected",
    appliesTo: ["extras", "pay"],
    kind: "judge",
    rule: "No paid bundle, bag, seat, insurance or other add-on is pre-selected or silently included in the price; every extra is opt-in.",
  },
];

export const PERSONAS: Persona[] = [
  {
    id: "family",
    name: "The Okafor family",
    photo: "/personas/family.png",
    memory: "Traveling with 2 kids (6 and 9) · must sit together · 4 checked bags",
    label: "Family of 4 · phone · EUR",
    context: { party: "family", pax: "4", surface: "inline", currency: "EUR", origin: "LHR" },
    style: "Parent booking for two adults and two kids. Cares about the total price and sitting together. Short messages typed on a phone.",
    contracts: FAMILY_CONTRACTS,
  },
  {
    id: "solo",
    name: "Maya Chen",
    photo: "/personas/solo.png",
    memory: "Prefers nonstop · lands before meetings · flexible fares · airline status",
    label: "Solo business · desktop · USD",
    context: { party: "solo", pax: "1", surface: "fullscreen", currency: "USD", origin: "JFK" },
    style: "Business traveler. Wants a nonstop and a sensible arrival time, decides fast, rarely browses.",
    contracts: SOLO_CONTRACTS,
  },
  {
    id: "budget-couple",
    name: "Sam & Priya",
    photo: "/personas/budget-couple.png",
    memory: "Flexible dates · carry-on only · wary of add-on fees",
    label: "Budget couple · phone · GBP",
    context: { party: "couple", pax: "2", surface: "inline", currency: "GBP", origin: "MAN" },
    style: "Couple on a tight budget. Will trade convenience for price, asks follow-up questions, may give up if extras pile on.",
    contracts: BUDGET_CONTRACTS,
  },
];

export const QUERIES: Query[] = [
  {
    id: "cheapest-morning",
    text: "Cheapest morning flight to Lisbon in March",
    constraints: { destination: "LIS", month: "2027-03", departAfter: "05:00", departBefore: "12:00", sort: "price" },
    hero: true,
  },
  {
    id: "nonstop-14th",
    text: "Nonstop to Lisbon on March 14, arriving before lunch",
    constraints: { destination: "LIS", date: "2027-03-14", maxStops: 0, departBefore: "10:00", sort: "depart" },
  },
  {
    id: "under-budget",
    text: "Anything to Lisbon in March under 100 per person?",
    constraints: { destination: "LIS", month: "2027-03", maxPricePerPax: 100, sort: "price" },
  },
];
