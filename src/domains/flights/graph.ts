import type { FlowGraph, Invariant, StateNode, Transition, TransitionKind } from "../../graph/types";

// Flight booking inside a chat assistant. One variant per stage for now;
// add variants (inline card vs full sheet) as extra nodes on the same stage.

export const STAGES = [
  "intent",
  "search",
  "results",
  "compare",
  "select",
  "seats",
  "extras",
  "passengers",
  "payment",
  "confirm",
] as const;

const nodes: StateNode[] = [
  { id: "intent", stage: "intent", component: "ChatPrompt", label: "Intent" },
  { id: "search", stage: "search", component: "SearchForm", label: "Search params" },
  { id: "results", stage: "results", component: "FareList", label: "Results" },
  { id: "compare", stage: "compare", component: "FareTable", label: "Compare fares" },
  { id: "select", stage: "select", component: "FareCard", label: "Select fare", acts: true },
  { id: "seats", stage: "seats", component: "SeatMap", label: "Seats" },
  { id: "extras", stage: "extras", component: "ExtrasSheet", label: "Bags & extras" },
  { id: "passengers", stage: "passengers", component: "PassengerForm", label: "Passengers" },
  { id: "payment", stage: "payment", component: "PaymentSheet", label: "Payment", acts: true },
  { id: "confirm", stage: "confirm", component: "Confirmation", label: "Confirmed", acts: true },
  { id: "price-changed", stage: "payment", component: "PriceChangeNotice", label: "Price changed" },
  { id: "sold-out", stage: "results", component: "SoldOutNotice", label: "Sold out" },
];

// Props that must survive once a fare is chosen.
const FARE = ["flightId", "price", "currency", "pax"];

const t = (from: string, to: string, kind: TransitionKind, carries?: string[]): Transition => ({
  id: `${from}->${to}`,
  from,
  to,
  kind,
  contract: carries ? { carries } : undefined,
});

const transitions: Transition[] = [
  t("intent", "search", "next"),
  t("intent", "results", "next"),
  t("search", "results", "next", ["pax", "currency"]),
  t("results", "compare", "next", ["pax", "currency"]),
  t("results", "select", "next", ["pax", "currency"]),
  t("results", "search", "refine"),
  t("results", "sold-out", "error"),
  t("sold-out", "results", "back"),
  t("compare", "select", "next", ["pax", "currency"]),
  t("compare", "results", "back"),
  t("select", "seats", "next", FARE),
  t("select", "passengers", "next", FARE),
  t("select", "results", "back"),
  t("seats", "extras", "next", FARE),
  t("seats", "passengers", "next", FARE),
  t("extras", "passengers", "next", FARE),
  t("passengers", "payment", "next", FARE),
  t("payment", "confirm", "next", FARE),
  t("payment", "price-changed", "error", ["flightId", "currency", "pax"]),
  t("price-changed", "payment", "next", ["flightId", "currency", "pax"]),
  t("price-changed", "results", "back"),
];

export const flightGraph: FlowGraph = { nodes, transitions };

const isPositiveNumber = (v: unknown) => typeof v === "number" && Number.isFinite(v) && v > 0;

export const flightInvariants: Invariant[] = [
  {
    id: "price-is-sourced",
    component: "FareCard",
    description: "Every price shown comes from a fare record",
    check: (p) => (p.fareSource ? null : "price shown without a fare record"),
  },
  {
    id: "payment-has-total",
    component: "PaymentSheet",
    description: "Payment always shows a positive total in a currency",
    check: (p) => (isPositiveNumber(p.price) && typeof p.currency === "string" ? null : "missing total or currency"),
  },
  {
    id: "pax-matches",
    component: "PassengerForm",
    description: "Passenger form has one entry per traveler",
    check: (p) => (p.forms === p.pax ? null : `forms=${String(p.forms)} but pax=${String(p.pax)}`),
  },
];
