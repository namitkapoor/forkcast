import type { SVGProps } from "react";
const s = (p: SVGProps<SVGSVGElement>) => ({ width: 12, height: 12, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true, ...p });
export const IconLock = (p: SVGProps<SVGSVGElement>) => (
  <svg {...s(p)}>
    <rect x="5" y="11" width="14" height="9" rx="2" />
    <path d="M8 11V8a4 4 0 018 0v3" />
  </svg>
);
export const IconBack = (p: SVGProps<SVGSVGElement>) => (
  <svg {...s(p)}>
    <path d="M15 6l-6 6 6 6" />
  </svg>
);
