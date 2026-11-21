import { A2UI_VERSION, BASIC_CATALOG_ID, type Screen } from "../a2ui/types";

// Hand-written screens so the renderer and canvas work before any model is called.

const v = A2UI_VERSION;

export const fixtureScreens: Screen[] = [
  {
    id: "fx-results-1",
    nodeId: "results",
    context: { trip: "round-trip", party: "family", surface: "inline", currency: "EUR" },
    variant: "stacked-fare-cards",
    rationale: "Families compare totals, so each card leads with the price for all four travelers.",
    model: "fixture",
    createdAt: "2026-11-21T00:00:00Z",
    annotations: [],
    messages: [
      { version: v, createSurface: { surfaceId: "fx-results-1", catalogId: BASIC_CATALOG_ID } },
      {
        version: v,
        updateComponents: {
          surfaceId: "fx-results-1",
          components: [
            { id: "root", component: "Column", children: ["title", "sub", "fare_list", "more_btn"], align: "stretch" },
            { id: "title", component: "Text", text: "Lisbon in March", variant: "h2" },
            { id: "sub", component: "Text", text: "Morning departures · 4 travelers", variant: "caption" },
            { id: "fare_list", component: "Column", children: ["card_1", "card_2", "card_3"] },
            { id: "card_1", component: "Card", child: "c1" },
            { id: "c1", component: "Row", children: ["c1_info", "c1_price"], justify: "spaceBetween", align: "center" },
            { id: "c1_info", component: "Text", text: "**TP 1353** · 07:10 → 09:45 · nonstop" },
            { id: "c1_price", component: "Text", text: { path: "/fares/0/total" }, variant: "h3" },
            { id: "card_2", component: "Card", child: "c2" },
            { id: "c2", component: "Row", children: ["c2_info", "c2_price"], justify: "spaceBetween", align: "center" },
            { id: "c2_info", component: "Text", text: "**FR 7241** · 06:25 → 09:05 · nonstop" },
            { id: "c2_price", component: "Text", text: { path: "/fares/1/total" }, variant: "h3" },
            { id: "card_3", component: "Card", child: "c3" },
            { id: "c3", component: "Row", children: ["c3_info", "c3_price"], justify: "spaceBetween", align: "center" },
            { id: "c3_info", component: "Text", text: "**IB 3104** · 08:40 → 13:15 · 1 stop" },
            { id: "c3_price", component: "Text", text: { path: "/fares/2/total" }, variant: "h3" },
            { id: "more_label", component: "Text", text: "Show more flights" },
            { id: "more_btn", component: "Button", child: "more_label", variant: "borderless", action: { event: { name: "showMore" } } },
          ],
        },
      },
      {
        version: v,
        updateDataModel: {
          surfaceId: "fx-results-1",
          path: "/fares",
          value: [{ total: "€1,284" }, { total: "€1,116" }, { total: "€1,048" }],
        },
      },
    ],
  },
  {
    id: "fx-payment-1",
    nodeId: "payment",
    context: { trip: "one-way", party: "solo", surface: "fullscreen", currency: "USD" },
    variant: "summary-then-pay",
    rationale: "Solo travelers on fullscreen get the full fare breakdown above a single pay button.",
    model: "fixture",
    createdAt: "2026-11-21T00:00:00Z",
    annotations: [],
    messages: [
      { version: v, createSurface: { surfaceId: "fx-payment-1", catalogId: BASIC_CATALOG_ID } },
      {
        version: v,
        updateComponents: {
          surfaceId: "fx-payment-1",
          components: [
            { id: "root", component: "Card", child: "body" },
            { id: "body", component: "Column", children: ["h", "route", "div", "total_row", "pay_btn"], align: "stretch" },
            { id: "h", component: "Text", text: "Review and pay", variant: "h2" },
            { id: "route", component: "Text", text: "JFK → LIS · Mar 14 · 1 traveler" },
            { id: "div", component: "Divider", axis: "horizontal" },
            { id: "total_row", component: "Row", children: ["total_l", "total_v"], justify: "spaceBetween" },
            { id: "total_l", component: "Text", text: "Total" },
            { id: "total_v", component: "Text", text: { path: "/fare/total" }, variant: "h3" },
            { id: "pay_label", component: "Text", text: "Pay now" },
            {
              id: "pay_btn",
              component: "Button",
              child: "pay_label",
              variant: "primary",
              action: { event: { name: "pay", context: { total: { path: "/fare/total" } } } },
            },
          ],
        },
      },
      { version: v, updateDataModel: { surfaceId: "fx-payment-1", path: "/fare", value: { total: "$612" } } },
    ],
  },
];
