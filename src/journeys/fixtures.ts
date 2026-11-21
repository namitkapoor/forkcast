import type { Persona, Query } from "./types";

// The MVP suite (SPEC.md): 3 personas × 3 queries.

export const PERSONAS: Persona[] = [
  {
    id: "family",
    name: "The Okafor family",
    photo: "/personas/family.png",
    memory: "Traveling with 2 kids (6 and 9) · must sit together · 4 checked bags",
    label: "Family of 4 · phone · EUR",
    context: { party: "family", pax: "4", surface: "inline", currency: "EUR", origin: "LHR" },
    style: "Parent booking for two adults and two kids. Cares about the total price and sitting together. Short messages typed on a phone.",
  },
  {
    id: "solo",
    name: "Maya Chen",
    photo: "/personas/solo.png",
    memory: "Prefers nonstop · lands before meetings · flexible fares · airline status",
    label: "Solo business · desktop · USD",
    context: { party: "solo", pax: "1", surface: "fullscreen", currency: "USD", origin: "JFK" },
    style: "Business traveler. Wants a nonstop and a sensible arrival time, decides fast, rarely browses.",
  },
  {
    id: "budget-couple",
    name: "Sam & Priya",
    photo: "/personas/budget-couple.png",
    memory: "Flexible dates · carry-on only · wary of add-on fees",
    label: "Budget couple · phone · GBP",
    context: { party: "couple", pax: "2", surface: "inline", currency: "GBP", origin: "MAN" },
    style: "Couple on a tight budget. Will trade convenience for price, asks follow-up questions, may give up if extras pile on.",
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
