import type { FlowProject } from '../types/studio';
import { DEFAULT_BUDGET_CONFIG } from '../ai/budgetPolicy';

const NOW = Date.now();

const LANDING_OPT_A = `
<div class="min-h-screen bg-[#FAF8F5] text-stone-900 font-sans">
  <header class="flex items-center justify-between px-12 py-6 border-b border-stone-200/80">
    <div class="flex items-center gap-3">
      <div class="w-9 h-9 rounded-xl bg-stone-900 text-amber-300 flex items-center justify-center font-bold text-lg">R</div>
      <span class="font-semibold tracking-tight text-xl">RoastCraft</span>
    </div>
    <nav class="flex items-center gap-8 text-sm font-medium text-stone-600">
      <a href="#" class="hover:text-stone-900">Single Origins</a>
      <a href="#" class="hover:text-stone-900">Subscriptions</a>
      <a href="#" class="hover:text-stone-900">Brew Guides</a>
      <button data-fc-edge="edge-landing-gift" class="text-amber-700 hover:text-amber-900 font-medium">Gift a Box</button>
    </nav>
    <button data-fc-edge="edge-landing-quiz" class="px-5 py-2.5 rounded-full bg-stone-900 text-white text-sm font-medium hover:bg-stone-800 transition">Start Taste Quiz</button>
  </header>

  <main class="grid grid-cols-12 gap-12 px-12 py-16 items-center max-w-6xl mx-auto">
    <div class="col-span-7 space-y-6">
      <span class="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-amber-100 text-amber-900 text-xs font-semibold tracking-wide uppercase">
        Roasted to order · Ships within 24h
      </span>
      <h1 class="text-5xl font-bold tracking-tight leading-[1.08] text-stone-950">
        Micro-lot coffee tuned to how you actually brew.
      </h1>
      <p class="text-lg text-stone-600 leading-relaxed max-w-xl">
        Take a 45-second flavor quiz and get rotating single-origin beans roasted specifically for pour-over, espresso, or French press.
      </p>
      <div class="flex items-center gap-4 pt-2">
        <button data-fc-edge="edge-landing-quiz" class="px-7 py-4 rounded-2xl bg-stone-950 text-white font-semibold text-base shadow-lg shadow-stone-900/15 hover:bg-stone-800 transition">
          Find My Coffee Match →
        </button>
        <button data-fc-edge="edge-landing-plans" class="px-6 py-4 rounded-2xl bg-white border border-stone-300 text-stone-800 font-semibold text-base hover:bg-stone-50 transition">
          Compare Plans
        </button>
      </div>
      <div class="flex items-center gap-8 pt-4 text-sm text-stone-500">
        <span>★ 4.9/5 from 14,200 brewers</span>
        <span>·</span>
        <span>Skip or cancel in 1 click</span>
      </div>
    </div>

    <div class="col-span-5">
      <div class="rounded-3xl bg-stone-900 text-stone-50 p-8 shadow-2xl space-y-6">
        <div class="flex items-center justify-between">
          <span class="text-xs uppercase tracking-widest text-amber-300 font-semibold">This Week's Featured Lot</span>
          <span class="px-2.5 py-1 rounded-full bg-white/10 text-xs">88.5 SCA</span>
        </div>
        <div class="h-44 rounded-2xl bg-gradient-to-br from-amber-600 via-orange-700 to-stone-900 p-6 flex flex-col justify-end">
          <div class="text-2xl font-bold">Ethiopia Worka Chelbessa</div>
          <div class="text-sm text-amber-100/80">Bergamot · White Peach · Jasmine Honey</div>
        </div>
        <div class="grid grid-cols-3 gap-3 text-center">
          <div class="rounded-xl bg-white/5 p-3">
            <div class="text-xs text-stone-400">Roast</div>
            <div class="font-semibold text-sm mt-0.5">Light-Med</div>
          </div>
          <div class="rounded-xl bg-white/5 p-3">
            <div class="text-xs text-stone-400">Elevation</div>
            <div class="font-semibold text-sm mt-0.5">2,150m</div>
          </div>
          <div class="rounded-xl bg-white/5 p-3">
            <div class="text-xs text-stone-400">Price</div>
            <div class="font-semibold text-sm mt-0.5">$18 / bag</div>
          </div>
        </div>
      </div>
    </div>
  </main>
</div>`;

const LANDING_OPT_B = `
<div class="min-h-screen bg-stone-950 text-stone-50 font-sans">
  <header class="flex items-center justify-between px-12 py-6 border-b border-stone-800">
    <span class="font-bold tracking-tight text-xl text-amber-300">RoastCraft</span>
    <div class="flex items-center gap-4">
      <button data-fc-edge="edge-landing-plans" class="text-sm text-stone-300 hover:text-white">Pricing</button>
      <button data-fc-edge="edge-landing-quiz" class="px-5 py-2.5 rounded-xl bg-amber-400 text-stone-950 font-semibold text-sm">Take Quiz</button>
    </div>
  </header>
  <main class="max-w-5xl mx-auto px-12 py-20 text-center space-y-8">
    <h1 class="text-6xl font-bold tracking-tight">Fresh micro-lots, zero guesswork.</h1>
    <p class="text-xl text-stone-400 max-w-2xl mx-auto">Answer 3 quick questions about your brew gear and flavor notes. We roast your bags Monday morning and ship direct.</p>
    <div class="flex justify-center gap-4">
      <button data-fc-edge="edge-landing-quiz" class="px-8 py-4 rounded-2xl bg-amber-400 text-stone-950 font-bold text-base">Start 3-Step Quiz →</button>
      <button data-fc-edge="edge-landing-gift" class="px-8 py-4 rounded-2xl border border-stone-700 text-stone-200 font-semibold text-base">Send as Gift</button>
    </div>
  </main>
</div>`;

const QUIZ_OPT_A = `
<div class="min-h-screen bg-[#FAF8F5] text-stone-900 font-sans flex flex-col">
  <header class="flex items-center justify-between px-12 py-5 border-b border-stone-200 bg-white">
    <span class="font-semibold text-lg">RoastCraft</span>
    <div class="flex items-center gap-3 w-80">
      <span class="text-xs font-semibold text-stone-500">Step 2 of 3</span>
      <div class="flex-1 h-2 rounded-full bg-stone-200 overflow-hidden">
        <div class="w-2/3 h-full bg-stone-900 rounded-full"></div>
      </div>
    </div>
    <button data-fc-edge="edge-quiz-plans" class="text-sm text-stone-500 hover:text-stone-900">Skip Quiz</button>
  </header>

  <main class="flex-1 max-w-4xl mx-auto w-full px-10 py-14 space-y-10">
    <div class="text-center space-y-3">
      <span class="text-xs font-semibold uppercase tracking-widest text-amber-700">Flavor Calibration</span>
      <h1 class="text-4xl font-bold tracking-tight">What flavor notes make your morning?</h1>
      <p class="text-stone-500">Pick up to two — we balance your monthly rotation around your palate.</p>
    </div>

    <div class="grid grid-cols-3 gap-5">
      <div class="rounded-2xl border-2 border-stone-900 bg-white p-6 shadow-md space-y-3 cursor-pointer">
        <div class="w-11 h-11 rounded-xl bg-amber-100 text-amber-800 flex items-center justify-center text-xl font-bold">✦</div>
        <div class="font-bold text-lg">Bright &amp; Fruity</div>
        <p class="text-sm text-stone-600">Citrus zest, stone fruit, floral aromatics. Light roast single origins.</p>
        <span class="inline-block text-xs font-semibold text-emerald-700 bg-emerald-50 px-2.5 py-1 rounded-full">Selected ✓</span>
      </div>

      <div class="rounded-2xl border border-stone-200 bg-white p-6 hover:border-stone-400 space-y-3 cursor-pointer">
        <div class="w-11 h-11 rounded-xl bg-orange-100 text-orange-800 flex items-center justify-center text-xl font-bold">●</div>
        <div class="font-bold text-lg">Caramel &amp; Nutty</div>
        <p class="text-sm text-stone-600">Toasted hazelnut, milk chocolate, brown sugar sweetness. Medium roast.</p>
      </div>

      <div class="rounded-2xl border border-stone-200 bg-white p-6 hover:border-stone-400 space-y-3 cursor-pointer">
        <div class="w-11 h-11 rounded-xl bg-stone-200 text-stone-800 flex items-center justify-center text-xl font-bold">◆</div>
        <div class="font-bold text-lg">Bold &amp; Velvety</div>
        <p class="text-sm text-stone-600">Dark cocoa, molasses, syrupy body designed for espresso &amp; milk drinks.</p>
      </div>
    </div>

    <div class="flex items-center justify-between pt-4 border-t border-stone-200">
      <button data-fc-edge="edge-quiz-back" class="px-5 py-3 rounded-xl text-stone-600 font-medium hover:bg-stone-200/60">← Back</button>
      <button data-fc-edge="edge-quiz-plans" class="px-8 py-3.5 rounded-2xl bg-stone-950 text-white font-semibold shadow-lg hover:bg-stone-800">See My Matched Plans →</button>
    </div>
  </main>
</div>`;

const QUIZ_OPT_B = `
<div class="min-h-screen bg-white text-stone-900 font-sans grid grid-cols-12">
  <aside class="col-span-4 bg-stone-900 text-white p-10 flex flex-col justify-between">
    <div class="space-y-6">
      <span class="text-amber-300 font-bold text-lg">RoastCraft Lab</span>
      <h2 class="text-3xl font-bold leading-tight">Live Palate Preview</h2>
      <p class="text-stone-400 text-sm">As you pick preferences, we tune your roast curve and bean origin in real time.</p>
      <div class="rounded-2xl bg-white/10 p-5 space-y-2">
        <div class="text-xs text-amber-300 uppercase font-semibold">Current Match (96%)</div>
        <div class="font-semibold text-lg">Kenya Nyeri AA + Colombia Huila</div>
        <div class="text-xs text-stone-300">Pour-over grind · Light-Medium</div>
      </div>
    </div>
    <div class="text-xs text-stone-500">3 questions · ~30 seconds</div>
  </aside>
  <main class="col-span-8 p-14 flex flex-col justify-center space-y-8">
    <h1 class="text-3xl font-bold">How do you brew most mornings?</h1>
    <div class="grid grid-cols-2 gap-4">
      <button class="p-5 rounded-2xl border-2 border-stone-900 text-left bg-amber-50/50">
        <div class="font-bold">Pour Over / V60</div>
        <div class="text-sm text-stone-500 mt-1">Clean cup, crisp acidity</div>
      </button>
      <button class="p-5 rounded-2xl border border-stone-200 text-left">
        <div class="font-bold">Espresso Machine</div>
        <div class="text-sm text-stone-500 mt-1">Rich crema, concentrated body</div>
      </button>
    </div>
    <div class="flex justify-end">
      <button data-fc-edge="edge-quiz-plans" class="px-7 py-3.5 rounded-xl bg-stone-900 text-white font-semibold">Continue to Plans →</button>
    </div>
  </main>
</div>`;

const PLANS_OPT_A = `
<div class="min-h-screen bg-[#FAF8F5] text-stone-900 font-sans">
  <header class="flex items-center justify-between px-12 py-5 bg-white border-b border-stone-200">
    <span class="font-semibold text-lg">RoastCraft</span>
    <span class="text-xs px-3 py-1 rounded-full bg-emerald-100 text-emerald-800 font-semibold">Matched to Bright &amp; Fruity · Pour-Over</span>
    <button data-fc-edge="edge-plans-gift" class="text-sm font-medium text-amber-700">Buying as a gift?</button>
  </header>

  <main class="max-w-5xl mx-auto px-10 py-12 space-y-8">
    <div class="flex items-end justify-between">
      <div>
        <h1 class="text-4xl font-bold tracking-tight">Choose your roast cadence</h1>
        <p class="text-stone-600 mt-2">Free shipping on every delivery. Pause or swap roasts anytime.</p>
      </div>
      <div class="inline-flex rounded-xl bg-stone-200 p-1 text-sm font-medium">
        <span class="px-4 py-1.5 rounded-lg bg-white shadow-sm text-stone-900">Every 2 Weeks</span>
        <span class="px-4 py-1.5 text-stone-600">Monthly</span>
      </div>
    </div>

    <div class="grid grid-cols-3 gap-6">
      <div class="rounded-3xl bg-white border border-stone-200 p-7 space-y-5">
        <div class="text-sm font-semibold text-stone-500">Solo Brewer</div>
        <div class="text-4xl font-bold">$18<span class="text-base font-normal text-stone-500"> / shipment</span></div>
        <p class="text-sm text-stone-600">1 × 12oz single-origin bag (~20 cups).</p>
        <ul class="text-sm text-stone-600 space-y-2 pt-2 border-t border-stone-100">
          <li>✓ Whole bean or custom grind</li>
          <li>✓ Tasting notes card</li>
        </ul>
        <button data-fc-edge="edge-plans-checkout" class="w-full py-3 rounded-xl border border-stone-300 font-semibold hover:bg-stone-50">Select Solo</button>
      </div>

      <div class="rounded-3xl bg-stone-950 text-white p-7 space-y-5 shadow-2xl ring-2 ring-amber-400 relative">
        <span class="absolute -top-3 right-6 px-3 py-1 rounded-full bg-amber-400 text-stone-950 text-xs font-bold uppercase">Most Popular · Save 15%</span>
        <div class="text-sm font-semibold text-amber-300">Explorer Duo</div>
        <div class="text-4xl font-bold">$31<span class="text-base font-normal text-stone-400"> / shipment</span></div>
        <p class="text-sm text-stone-300">2 × 12oz contrasting micro-lots (~40 cups).</p>
        <ul class="text-sm text-stone-300 space-y-2 pt-2 border-t border-stone-800">
          <li>✓ 2 curated single-origin roasts</li>
          <li>✓ Priority access to rare Geisha lots</li>
          <li>✓ Free express shipping</li>
        </ul>
        <button data-fc-edge="edge-plans-checkout" class="w-full py-3.5 rounded-xl bg-amber-400 text-stone-950 font-bold hover:bg-amber-300 transition">Continue with Explorer Duo →</button>
      </div>

      <div class="rounded-3xl bg-white border border-stone-200 p-7 space-y-5">
        <div class="text-sm font-semibold text-stone-500">Household / Studio</div>
        <div class="text-4xl font-bold">$54<span class="text-base font-normal text-stone-500"> / shipment</span></div>
        <p class="text-sm text-stone-600">4 × 12oz bags for daily multi-cup teams.</p>
        <ul class="text-sm text-stone-600 space-y-2 pt-2 border-t border-stone-100">
          <li>✓ Mix light &amp; espresso roasts</li>
          <li>✓ Dedicated roaster SMS concierge</li>
        </ul>
        <button data-fc-edge="edge-plans-checkout" class="w-full py-3 rounded-xl border border-stone-300 font-semibold hover:bg-stone-50">Select Studio</button>
      </div>
    </div>
  </main>
</div>`;

const PLANS_OPT_B = `
<div class="min-h-screen bg-white text-stone-900 font-sans p-12 max-w-4xl mx-auto space-y-8">
  <h1 class="text-3xl font-bold">Build Your Box</h1>
  <div class="grid grid-cols-12 gap-8">
    <div class="col-span-7 space-y-6">
      <div class="p-6 rounded-2xl border border-stone-200 space-y-3">
        <div class="font-semibold">1. Bags per delivery</div>
        <div class="grid grid-cols-3 gap-3">
          <div class="p-3 rounded-xl border border-stone-200 text-center">1 Bag ($18)</div>
          <div class="p-3 rounded-xl border-2 border-stone-900 bg-stone-50 text-center font-bold">2 Bags ($31)</div>
          <div class="p-3 rounded-xl border border-stone-200 text-center">4 Bags ($54)</div>
        </div>
      </div>
      <div class="p-6 rounded-2xl border border-stone-200 space-y-3">
        <div class="font-semibold">2. Delivery rhythm</div>
        <div class="grid grid-cols-2 gap-3">
          <div class="p-3 rounded-xl border-2 border-stone-900 bg-stone-50 text-center font-bold">Every 2 weeks</div>
          <div class="p-3 rounded-xl border border-stone-200 text-center">Every 4 weeks</div>
        </div>
      </div>
    </div>
    <div class="col-span-5 rounded-2xl bg-stone-900 text-white p-7 space-y-4">
      <div class="text-xs text-amber-300 uppercase font-semibold">Live Plan Summary</div>
      <div class="text-2xl font-bold">Explorer Duo · $31</div>
      <p class="text-sm text-stone-400">Ships Monday · Free delivery · Cancel anytime</p>
      <button data-fc-edge="edge-plans-checkout" class="w-full py-3.5 rounded-xl bg-amber-400 text-stone-950 font-bold">Proceed to Checkout →</button>
    </div>
  </div>
</div>`;

const PLANS_OPT_C_HIDDEN = `
<div class="min-h-screen bg-stone-100 p-12 font-sans">
  <h1 class="text-2xl font-bold mb-6">Full Comparison Table (Legacy Matrix)</h1>
  <div class="bg-white rounded-xl border border-stone-300 p-6 text-sm text-stone-600">
    Dense 14-row feature matrix comparing Solo, Duo, Studio, and Wholesale plans...
  </div>
</div>`;

const CHECKOUT_OPT_A = `
<div class="min-h-screen bg-[#FAF8F5] text-stone-900 font-sans">
  <header class="flex items-center justify-between px-12 py-5 bg-white border-b border-stone-200">
    <div class="flex items-center gap-3">
      <button data-fc-edge="edge-checkout-back" class="text-sm text-stone-500 hover:text-stone-900">← Change Plan</button>
      <span class="text-stone-300">|</span>
      <span class="font-semibold">RoastCraft Express Checkout</span>
    </div>
    <span class="text-xs text-stone-500 font-medium">🔒 256-bit Encrypted · Cancel anytime</span>
  </header>

  <main class="max-w-5xl mx-auto px-10 py-10 grid grid-cols-12 gap-8">
    <section class="col-span-7 space-y-6">
      <div class="rounded-2xl bg-white border border-stone-200 p-6 space-y-4">
        <div class="flex items-center justify-between">
          <h2 class="font-bold text-lg">1. Shipping Address</h2>
          <span class="text-xs text-emerald-700 font-medium">Arrives Thu, Nov 26</span>
        </div>
        <div class="grid grid-cols-2 gap-3">
          <input value="Maya Lin" readonly class="px-3.5 py-2.5 rounded-xl border border-stone-300 text-sm bg-stone-50" />
          <input value="maya@studio.design" readonly class="px-3.5 py-2.5 rounded-xl border border-stone-300 text-sm bg-stone-50" />
          <input value="214 Crosby St, Apt 4B, New York, NY" readonly class="col-span-2 px-3.5 py-2.5 rounded-xl border border-stone-300 text-sm bg-stone-50" />
        </div>
      </div>

      <div class="rounded-2xl bg-white border border-stone-200 p-6 space-y-4">
        <h2 class="font-bold text-lg">2. Payment Method</h2>
        <div class="grid grid-cols-2 gap-3">
          <button class="py-3 rounded-xl bg-black text-white font-semibold text-sm"> Apple Pay</button>
          <button class="py-3 rounded-xl bg-indigo-600 text-white font-semibold text-sm">Shop Pay</button>
        </div>
        <div class="text-center text-xs text-stone-400">or pay with card</div>
        <input value="•••• •••• •••• 4242   ·   08/29" readonly class="w-full px-3.5 py-2.5 rounded-xl border border-stone-300 text-sm bg-stone-50" />
      </div>

      <button id="checkout-primary-cta" data-fc-edge="edge-checkout-confirm" class="w-full py-4 rounded-2xl bg-stone-950 text-white font-bold text-base shadow-lg hover:bg-stone-800 transition">
        Start Subscription · $31.00
      </button>
    </section>

    <aside id="order-summary-card" class="col-span-5">
      <div class="rounded-3xl bg-white border border-stone-200 p-7 space-y-5 shadow-sm">
        <div class="flex items-center justify-between">
          <h3 class="font-bold text-lg">Order Summary</h3>
          <span class="text-xs px-2.5 py-1 rounded-full bg-amber-100 text-amber-900 font-semibold">FIRST15 Applied</span>
        </div>
        <div class="flex items-center gap-4 pb-4 border-b border-stone-100">
          <div class="w-16 h-16 rounded-2xl bg-gradient-to-br from-amber-600 to-stone-900"></div>
          <div>
            <div class="font-semibold">Explorer Duo (2 × 12oz)</div>
            <div class="text-xs text-stone-500">Bright &amp; Fruity · Whole Bean · Every 2 weeks</div>
          </div>
        </div>
        <div class="space-y-2 text-sm">
          <div class="flex justify-between text-stone-600"><span>Subscription Subtotal</span><span>$36.00</span></div>
          <div class="flex justify-between text-emerald-700 font-medium"><span>Subscriber Discount (15%)</span><span>−$5.00</span></div>
          <div class="flex justify-between text-stone-600"><span>Express Roast Shipping</span><span class="text-emerald-700 font-medium">Free</span></div>
          <div class="flex justify-between font-bold text-base pt-3 border-t border-stone-200"><span>Total Due Today</span><span>$31.00</span></div>
        </div>
        <div class="rounded-xl bg-stone-50 p-3.5 text-xs text-stone-600 leading-relaxed">
          Roasted Monday morning. Reminder email sent 3 days before every renewal — skip or cancel with one click.
        </div>
      </div>
    </aside>
  </main>
</div>`;

const CHECKOUT_OPT_B = `
<div class="min-h-screen bg-white text-stone-900 font-sans max-w-2xl mx-auto px-10 py-12 space-y-6">
  <div class="flex items-center justify-between">
    <h1 class="text-2xl font-bold">One-Column Express Checkout</h1>
    <span class="text-sm font-bold text-emerald-700">$31.00 · Free Shipping</span>
  </div>
  <div class="rounded-2xl bg-stone-50 border border-stone-200 p-4 flex items-center justify-between">
    <div>
      <div class="font-semibold text-sm">Explorer Duo · Every 2 Weeks</div>
      <div class="text-xs text-stone-500">Ethiopia Worka + Kenya Nyeri · Save 15%</div>
    </div>
    <span class="text-xs underline text-stone-600">Details</span>
  </div>
  <button class="w-full py-3.5 rounded-xl bg-black text-white font-semibold">Express Pay with Apple Pay</button>
  <div class="rounded-2xl border border-stone-200 p-5 space-y-3">
    <div class="font-semibold text-sm">Shipping &amp; Card</div>
    <input value="214 Crosby St, New York, NY" readonly class="w-full px-3 py-2 rounded-lg border border-stone-300 text-sm" />
    <input value="•••• •••• •••• 4242" readonly class="w-full px-3 py-2 rounded-lg border border-stone-300 text-sm" />
  </div>
  <button data-fc-edge="edge-checkout-confirm" class="w-full py-4 rounded-xl bg-emerald-600 text-white font-bold">Complete Order — $31.00 →</button>
</div>`;

const GIFT_OPT_A = `
<div class="min-h-screen bg-[#FFFBF2] text-stone-900 font-sans px-12 py-12 max-w-4xl mx-auto space-y-8">
  <div class="flex items-center justify-between">
    <span class="font-semibold text-lg">RoastCraft Gifting</span>
    <button data-fc-edge="edge-gift-plans" class="text-sm text-stone-600 hover:text-stone-900">Back to Regular Plans</button>
  </div>
  <div class="rounded-3xl bg-white border border-amber-200 p-9 space-y-6 shadow-sm">
    <span class="px-3 py-1 rounded-full bg-amber-100 text-amber-900 text-xs font-semibold">Prepaid Gift Box</span>
    <h1 class="text-3xl font-bold">Give 3 months of fresh micro-lot coffee.</h1>
    <div class="grid grid-cols-3 gap-4">
      <div class="p-4 rounded-2xl border border-stone-200">3 Months · $58</div>
      <div class="p-4 rounded-2xl border-2 border-amber-600 bg-amber-50 font-bold">6 Months · $108</div>
      <div class="p-4 rounded-2xl border border-stone-200">12 Months · $199</div>
    </div>
    <button data-fc-edge="edge-gift-checkout" class="px-7 py-3.5 rounded-xl bg-stone-900 text-white font-semibold">Continue to Gift Checkout →</button>
  </div>
</div>`;

export function createStarterProject(): FlowProject {
  return {
    id: 'proj-roastcraft',
    name: 'RoastCraft Web Subscription',
    productBrief:
      'Desktop-first specialty coffee subscription web journey with flavor quiz, cadence selector, and express checkout.',
    devicePreset: 'desktop',
    canvasView: 'flow',
    selectedScreenId: 'checkout',
    selectedEdgeId: null,
    budgetConfig: structuredClone(DEFAULT_BUDGET_CONFIG),
    pendingDisambiguation: null,
    focusZones: {
      'zone-core-conversion': {
        id: 'zone-core-conversion',
        name: 'Core Conversion Flow',
        priority: 'core',
        screenIds: ['quiz', 'plans', 'checkout'],
        budgetWeight: 0.65,
      },
      'zone-supporting': {
        id: 'zone-supporting',
        name: 'Entry & Post-Purchase',
        priority: 'supporting',
        screenIds: ['landing', 'confirmation', 'gift'],
        budgetWeight: 0.35,
      },
    },
    screens: {
      landing: {
        id: 'landing',
        slug: 'Landing',
        title: 'RoastCraft Hero',
        stage: 'Discovery',
        description: 'Editorial landing page introducing micro-lot quiz and plan entry points.',
        priority: 'standard',
        policyMode: 'exploit-locked',
        fidelity: 'interactive',
        isInFinalFlow: true,
        position: { x: 40, y: 120 },
        activeVariantId: 'landing-a',
        finalizedVariantId: 'landing-a',
        status: 'idle',
        evaluation: {
          overallScore: 91,
          dimensions: {
            usability: 93,
            visualHierarchy: 92,
            accessibility: 89,
            flowContinuity: 90,
          },
          summary: 'Clear value prop, unmistakable primary CTA, and strong visual anchor.',
          modelUsed: 'gemini-4-neon',
          tokensUsed: 2940,
          evaluatedAt: NOW - 1000 * 60 * 12,
        },
        variants: [
          {
            id: 'landing-a',
            label: 'Option A — Editorial Split',
            rationale: 'Warm editorial hero paired with featured micro-lot tasting card.',
            fidelity: 'interactive',
            isHidden: false,
            html: LANDING_OPT_A,
            createdAt: NOW - 1000 * 60 * 25,
            modelUsed: 'gemini-4-neon',
            tokensUsed: 4620,
            banditStats: {
              alpha: 11.4,
              beta: 1.8,
              impressions: 9,
              completions: 8,
              hesitations: 0,
              backtracks: 0,
              avgDwellMs: 4200,
            },
          },
          {
            id: 'landing-b',
            label: 'Option B — Dark Centered',
            rationale: 'High-contrast minimal centered hero for faster CTA scan.',
            fidelity: 'interactive',
            isHidden: false,
            html: LANDING_OPT_B,
            createdAt: NOW - 1000 * 60 * 22,
            modelUsed: 'gemini-4-neon',
            tokensUsed: 3810,
            banditStats: {
              alpha: 4.2,
              beta: 2.6,
              impressions: 4,
              completions: 2,
              hesitations: 1,
              backtracks: 0,
              avgDwellMs: 6800,
            },
          },
        ],
        annotations: [],
      },

      quiz: {
        id: 'quiz',
        slug: 'Quiz',
        title: 'Taste Profile Quiz',
        stage: 'Personalization',
        description: '3-step flavor & brew method calibration guiding plan match.',
        priority: 'core',
        policyMode: 'explore',
        fidelity: 'interactive',
        isInFinalFlow: true,
        position: { x: 560, y: 80 },
        activeVariantId: 'quiz-a',
        finalizedVariantId: 'quiz-a',
        status: 'idle',
        evaluation: {
          overallScore: 86,
          dimensions: {
            usability: 89,
            visualHierarchy: 88,
            accessibility: 84,
            flowContinuity: 83,
          },
          summary: 'Clean 3-card flavor choice with clear progress bar; consider showing live match preview.',
          modelUsed: 'gemini-4-carbon',
          tokensUsed: 4920,
          evaluatedAt: NOW - 1000 * 60 * 10,
        },
        variants: [
          {
            id: 'quiz-a',
            label: 'Option A — 3-Card Palate',
            rationale: 'Low-friction visual taste cards with clear step progress bar.',
            fidelity: 'interactive',
            isHidden: false,
            html: QUIZ_OPT_A,
            createdAt: NOW - 1000 * 60 * 20,
            modelUsed: 'gemini-4-carbon',
            tokensUsed: 7940,
            banditStats: {
              alpha: 8.5,
              beta: 2.1,
              impressions: 7,
              completions: 6,
              hesitations: 1,
              backtracks: 0,
              avgDwellMs: 5300,
            },
          },
          {
            id: 'quiz-b',
            label: 'Option B — Live Match Sidebar',
            rationale: 'Split layout revealing the matched coffee origins live as users click.',
            fidelity: 'interactive',
            isHidden: false,
            html: QUIZ_OPT_B,
            createdAt: NOW - 1000 * 60 * 18,
            modelUsed: 'gemini-4-carbon',
            tokensUsed: 8410,
            banditStats: {
              alpha: 5.4,
              beta: 2.2,
              impressions: 4,
              completions: 3,
              hesitations: 0,
              backtracks: 1,
              avgDwellMs: 6100,
            },
          },
        ],
        annotations: [],
      },

      plans: {
        id: 'plans',
        slug: 'PlanSelect',
        title: 'Subscription Plans',
        stage: 'Selection',
        description: 'Cadence & bag tier selector highlighting the recommended Explorer Duo.',
        priority: 'core',
        policyMode: 'explore',
        fidelity: 'interactive',
        isInFinalFlow: true,
        position: { x: 1080, y: 80 },
        activeVariantId: 'plans-a',
        finalizedVariantId: 'plans-a',
        status: 'idle',
        evaluation: {
          overallScore: 84,
          dimensions: {
            usability: 86,
            visualHierarchy: 90,
            accessibility: 82,
            flowContinuity: 79,
          },
          summary: 'Strong visual anchoring on Explorer Duo; carry quiz taste tags more visibly into the card.',
          modelUsed: 'gemini-4-carbon',
          tokensUsed: 5110,
          evaluatedAt: NOW - 1000 * 60 * 8,
        },
        variants: [
          {
            id: 'plans-a',
            label: 'Option A — 3-Tier Cards',
            rationale: 'Classic 3-column tier layout with high-contrast center anchor.',
            fidelity: 'interactive',
            isHidden: false,
            html: PLANS_OPT_A,
            createdAt: NOW - 1000 * 60 * 16,
            modelUsed: 'gemini-4-carbon',
            tokensUsed: 8620,
            banditStats: {
              alpha: 7.8,
              beta: 2.5,
              impressions: 7,
              completions: 5,
              hesitations: 1,
              backtracks: 1,
              avgDwellMs: 7400,
            },
          },
          {
            id: 'plans-b',
            label: 'Option B — Box Builder',
            rationale: 'Interactive 2-step configurator with sticky live summary card.',
            fidelity: 'interactive',
            isHidden: false,
            html: PLANS_OPT_B,
            createdAt: NOW - 1000 * 60 * 15,
            modelUsed: 'gemini-4-carbon',
            tokensUsed: 7850,
            banditStats: {
              alpha: 6.2,
              beta: 2.9,
              impressions: 5,
              completions: 4,
              hesitations: 1,
              backtracks: 0,
              avgDwellMs: 6900,
            },
          },
          {
            id: 'plans-c',
            label: 'Option C — Dense Matrix',
            rationale: 'Legacy 14-row feature comparison table (parked to reduce clutter).',
            fidelity: 'wireframe',
            isHidden: true,
            html: PLANS_OPT_C_HIDDEN,
            createdAt: NOW - 1000 * 60 * 14,
            modelUsed: 'gemini-4-neon',
            tokensUsed: 3120,
            banditStats: {
              alpha: 1.8,
              beta: 5.4,
              impressions: 4,
              completions: 1,
              hesitations: 3,
              backtracks: 2,
              avgDwellMs: 14800,
            },
          },
        ],
        annotations: [],
      },

      checkout: {
        id: 'checkout',
        slug: 'Checkout',
        title: 'Express Checkout',
        stage: 'Conversion',
        description: 'Shipping, express wallets, and transparent subscription renewal summary.',
        priority: 'core',
        policyMode: 'explore',
        fidelity: 'interactive',
        isInFinalFlow: true,
        position: { x: 1600, y: 80 },
        activeVariantId: 'checkout-a',
        finalizedVariantId: 'checkout-a',
        status: 'idle',
        evaluation: {
          overallScore: 72,
          dimensions: {
            usability: 76,
            visualHierarchy: 71,
            accessibility: 74,
            flowContinuity: 67,
          },
          summary:
            'Primary CTA sits below card fields causing hesitation; renewal terms should sit directly next to the Subscribe CTA.',
          modelUsed: 'gemini-4-carbon',
          tokensUsed: 5640,
          evaluatedAt: NOW - 1000 * 60 * 5,
        },
        variants: [
          {
            id: 'checkout-a',
            label: 'Option A — Split Summary',
            rationale: 'Two-column desktop checkout with persistent right-hand breakdown.',
            fidelity: 'interactive',
            isHidden: false,
            html: CHECKOUT_OPT_A,
            createdAt: NOW - 1000 * 60 * 12,
            modelUsed: 'gemini-4-carbon',
            tokensUsed: 9420,
            banditStats: {
              alpha: 5.1,
              beta: 4.4,
              impressions: 7,
              completions: 4,
              hesitations: 3,
              backtracks: 2,
              avgDwellMs: 13200,
            },
          },
          {
            id: 'checkout-b',
            label: 'Option B — Single Column',
            rationale: 'Streamlined single-column wallet-first checkout with compact summary.',
            fidelity: 'interactive',
            isHidden: false,
            html: CHECKOUT_OPT_B,
            createdAt: NOW - 1000 * 60 * 9,
            modelUsed: 'gemini-4-carbon',
            tokensUsed: 8140,
            banditStats: {
              alpha: 4.4,
              beta: 2.3,
              impressions: 3,
              completions: 3,
              hesitations: 0,
              backtracks: 0,
              avgDwellMs: 6400,
            },
          },
        ],
        annotations: [
          {
            id: 'ann-checkout-pin-1',
            mentionTag: 'Pin-1',
            screenId: 'checkout',
            variantId: 'checkout-a',
            author: 'designer',
            kind: 'point-element',
            includeInAiFeedback: true,
            xPercent: 31,
            yPercent: 78,
            elementTarget: {
              selector: '#checkout-primary-cta',
              tagName: 'button',
              textSnippet: 'Start Subscription · $31.00',
              boundingBox: { x: 88, y: 610, w: 540, h: 56 },
            },
            category: 'hierarchy',
            severity: 'warning',
            comment:
              'Make this CTA emerald with a subtle lock icon and place the "Cancel in 1 click" reassurance directly underneath it.',
            status: 'open',
            createdAt: NOW - 1000 * 60 * 7,
            revisions: [
              {
                id: 'rev-1',
                revisionNumber: 1,
                timestamp: NOW - 1000 * 60 * 7,
                author: 'designer',
                comment: 'CTA blends too closely with Apple Pay button above.',
                category: 'hierarchy',
                status: 'open',
              },
              {
                id: 'rev-2',
                revisionNumber: 2,
                timestamp: NOW - 1000 * 60 * 4,
                author: 'designer',
                comment:
                  'Make this CTA emerald with a subtle lock icon and place the "Cancel in 1 click" reassurance directly underneath it.',
                category: 'hierarchy',
                status: 'open',
              },
            ],
          },
          {
            id: 'ann-checkout-mask-1',
            mentionTag: 'Mask-1',
            screenId: 'checkout',
            variantId: 'checkout-a',
            author: 'designer',
            kind: 'paint-region',
            includeInAiFeedback: false,
            xPercent: 74,
            yPercent: 45,
            paintTarget: {
              strokes: [
                [
                  { xPercent: 58, yPercent: 25 },
                  { xPercent: 89, yPercent: 25 },
                  { xPercent: 89, yPercent: 68 },
                  { xPercent: 58, yPercent: 68 },
                  { xPercent: 58, yPercent: 25 },
                ],
              ],
              boundingBoxPercent: { x: 58, y: 25, w: 31, h: 43 },
              intersectingSelectors: ['#order-summary-card'],
            },
            category: 'copy',
            severity: 'info',
            comment:
              'Personal note: check with ops team whether Thursday delivery date is guaranteed on West Coast (excluded from AI prompt for now).',
            status: 'open',
            createdAt: NOW - 1000 * 60 * 3,
            revisions: [
              {
                id: 'rev-m1',
                revisionNumber: 1,
                timestamp: NOW - 1000 * 60 * 3,
                author: 'designer',
                comment:
                  'Personal note: check with ops team whether Thursday delivery date is guaranteed on West Coast (excluded from AI prompt for now).',
                category: 'copy',
                status: 'open',
              },
            ],
          },
        ],
      },

      confirmation: {
        id: 'confirmation',
        slug: 'Confirmation',
        title: 'First Roast Welcome',
        stage: 'Post-Purchase',
        description: 'Order confirmation, roast calendar preview, and referral link.',
        priority: 'supporting',
        policyMode: 'explore',
        fidelity: 'skeleton',
        isInFinalFlow: true,
        position: { x: 2120, y: 80 },
        activeVariantId: 'confirm-skel',
        finalizedVariantId: 'confirm-skel',
        status: 'idle',
        evaluation: null,
        variants: [
          {
            id: 'confirm-skel',
            label: 'Skeleton Preview',
            rationale:
              'Progressive Reveal: kept as low-token skeleton so budget concentrates on Core Conversion.',
            fidelity: 'skeleton',
            isHidden: false,
            html: '',
            skeletonBullets: [
              'Order #RC-4821 confirmed banner + Thursday roast date',
              'Matched beans timeline (Roast Mon → Ship Tue → Brew Thu)',
              '1-click Manage Cadence & Refer a Friend ($10 credit)',
            ],
            createdAt: NOW - 1000 * 60 * 11,
            modelUsed: 'gemini-4-hydrogen',
            tokensUsed: 740,
            banditStats: {
              alpha: 6.0,
              beta: 1.0,
              impressions: 5,
              completions: 5,
              hesitations: 0,
              backtracks: 0,
              avgDwellMs: 3100,
            },
          },
        ],
        annotations: [],
      },

      gift: {
        id: 'gift',
        slug: 'GiftFlow',
        title: 'Prepaid Gift Box',
        stage: 'Exploratory Branch',
        description: 'Optional prepaid 3/6/12-month gifting path (outside core Final Flow).',
        priority: 'supporting',
        policyMode: 'explore',
        fidelity: 'interactive',
        isInFinalFlow: false,
        position: { x: 820, y: 530 },
        activeVariantId: 'gift-a',
        finalizedVariantId: null,
        status: 'idle',
        evaluation: null,
        variants: [
          {
            id: 'gift-a',
            label: 'Option A — Prepaid Tiers',
            rationale: 'Simple prepaid duration picker for holiday & birthday gifters.',
            fidelity: 'interactive',
            isHidden: false,
            html: GIFT_OPT_A,
            createdAt: NOW - 1000 * 60 * 10,
            modelUsed: 'gemini-4-hydrogen',
            tokensUsed: 2350,
            banditStats: {
              alpha: 2.5,
              beta: 2.0,
              impressions: 2,
              completions: 1,
              hesitations: 1,
              backtracks: 0,
              avgDwellMs: 8200,
            },
          },
        ],
        annotations: [],
      },
    },
    edges: {
      'edge-landing-quiz': {
        id: 'edge-landing-quiz',
        sourceScreenId: 'landing',
        targetScreenId: 'quiz',
        label: 'Start Taste Quiz',
        edgeType: 'primary',
        isFinalFlowEdge: true,
        metrics: { traversals: 9, completions: 8, backtracks: 0, continuityScore: 94 },
      },
      'edge-landing-plans': {
        id: 'edge-landing-plans',
        sourceScreenId: 'landing',
        targetScreenId: 'plans',
        label: 'Compare Plans',
        edgeType: 'alternate',
        isFinalFlowEdge: false,
        metrics: { traversals: 3, completions: 2, backtracks: 0, continuityScore: 86 },
      },
      'edge-landing-gift': {
        id: 'edge-landing-gift',
        sourceScreenId: 'landing',
        targetScreenId: 'gift',
        label: 'Gift a Box',
        edgeType: 'alternate',
        isFinalFlowEdge: false,
        metrics: { traversals: 2, completions: 1, backtracks: 0, continuityScore: 82 },
      },
      'edge-quiz-plans': {
        id: 'edge-quiz-plans',
        sourceScreenId: 'quiz',
        targetScreenId: 'plans',
        label: 'See Matched Plans',
        edgeType: 'primary',
        isFinalFlowEdge: true,
        metrics: { traversals: 8, completions: 7, backtracks: 0, continuityScore: 89 },
      },
      'edge-quiz-back': {
        id: 'edge-quiz-back',
        sourceScreenId: 'quiz',
        targetScreenId: 'landing',
        label: 'Back',
        edgeType: 'back',
        isFinalFlowEdge: false,
        metrics: { traversals: 1, completions: 0, backtracks: 1 },
      },
      'edge-plans-checkout': {
        id: 'edge-plans-checkout',
        sourceScreenId: 'plans',
        targetScreenId: 'checkout',
        label: 'Select Explorer Duo',
        edgeType: 'primary',
        isFinalFlowEdge: true,
        metrics: { traversals: 7, completions: 5, backtracks: 1, continuityScore: 81 },
      },
      'edge-plans-gift': {
        id: 'edge-plans-gift',
        sourceScreenId: 'plans',
        targetScreenId: 'gift',
        label: 'Switch to Gift',
        edgeType: 'alternate',
        isFinalFlowEdge: false,
        metrics: { traversals: 1, completions: 1, backtracks: 0 },
      },
      'edge-gift-checkout': {
        id: 'edge-gift-checkout',
        sourceScreenId: 'gift',
        targetScreenId: 'checkout',
        label: 'Gift Checkout',
        edgeType: 'alternate',
        isFinalFlowEdge: false,
        metrics: { traversals: 1, completions: 1, backtracks: 0 },
      },
      'edge-checkout-confirm': {
        id: 'edge-checkout-confirm',
        sourceScreenId: 'checkout',
        targetScreenId: 'confirmation',
        label: 'Start Subscription',
        edgeType: 'primary',
        isFinalFlowEdge: true,
        metrics: { traversals: 7, completions: 4, backtracks: 2, continuityScore: 68 },
      },
      'edge-checkout-back': {
        id: 'edge-checkout-back',
        sourceScreenId: 'checkout',
        targetScreenId: 'plans',
        label: 'Change Plan',
        edgeType: 'back',
        isFinalFlowEdge: false,
        metrics: { traversals: 2, completions: 0, backtracks: 2 },
      },
    },
    traces: [
      {
        id: 'trace-seed-1',
        actor: 'simulated-persona',
        personaLabel: 'Morning Pour-Over Enthusiast',
        startedAt: NOW - 1000 * 60 * 9,
        completed: true,
        steps: [
          {
            screenId: 'landing',
            variantId: 'landing-a',
            edgeIdTaken: 'edge-landing-quiz',
            enteredAt: NOW - 1000 * 60 * 9,
            dwellMs: 4100,
            deadClicks: 0,
            hesitated: false,
            backtracked: false,
          },
          {
            screenId: 'quiz',
            variantId: 'quiz-a',
            edgeIdTaken: 'edge-quiz-plans',
            enteredAt: NOW - 1000 * 60 * 8.9,
            dwellMs: 5200,
            deadClicks: 0,
            hesitated: false,
            backtracked: false,
          },
          {
            screenId: 'plans',
            variantId: 'plans-a',
            edgeIdTaken: 'edge-plans-checkout',
            enteredAt: NOW - 1000 * 60 * 8.8,
            dwellMs: 6800,
            deadClicks: 0,
            hesitated: false,
            backtracked: false,
          },
          {
            screenId: 'checkout',
            variantId: 'checkout-a',
            edgeIdTaken: 'edge-checkout-confirm',
            enteredAt: NOW - 1000 * 60 * 8.6,
            dwellMs: 13900,
            deadClicks: 2,
            hesitated: true,
            backtracked: false,
          },
          {
            screenId: 'confirmation',
            variantId: 'confirm-skel',
            enteredAt: NOW - 1000 * 60 * 8.3,
            dwellMs: 3000,
            deadClicks: 0,
            hesitated: false,
            backtracked: false,
          },
        ],
      },
    ],
    tokenLedger: [
      {
        id: 'tok-1',
        timestamp: NOW - 1000 * 60 * 25,
        action: 'generate-flow',
        priority: 'standard',
        model: 'gemini-4-neon',
        promptTokens: 1200,
        outputTokens: 3420,
        thoughtTokens: 0,
        totalTokens: 4620,
      },
      {
        id: 'tok-2',
        timestamp: NOW - 1000 * 60 * 20,
        action: 'generate-variant',
        screenId: 'quiz',
        priority: 'core',
        model: 'gemini-4-carbon',
        promptTokens: 2100,
        outputTokens: 12450,
        thoughtTokens: 1800,
        totalTokens: 16350,
      },
      {
        id: 'tok-3',
        timestamp: NOW - 1000 * 60 * 16,
        action: 'generate-variant',
        screenId: 'plans',
        priority: 'core',
        model: 'gemini-4-carbon',
        promptTokens: 2400,
        outputTokens: 12170,
        thoughtTokens: 1900,
        totalTokens: 16470,
      },
      {
        id: 'tok-4',
        timestamp: NOW - 1000 * 60 * 12,
        action: 'generate-variant',
        screenId: 'checkout',
        priority: 'core',
        model: 'gemini-4-carbon',
        promptTokens: 2800,
        outputTokens: 12660,
        thoughtTokens: 2100,
        totalTokens: 17560,
      },
      {
        id: 'tok-5',
        timestamp: NOW - 1000 * 60 * 11,
        action: 'generate-variant',
        screenId: 'confirmation',
        priority: 'supporting',
        model: 'gemini-4-hydrogen',
        promptTokens: 320,
        outputTokens: 420,
        thoughtTokens: 0,
        totalTokens: 740,
      },
      {
        id: 'tok-6',
        timestamp: NOW - 1000 * 60 * 5,
        action: 'ux-eval',
        screenId: 'checkout',
        priority: 'core',
        model: 'gemini-4-carbon',
        promptTokens: 2940,
        outputTokens: 1800,
        thoughtTokens: 900,
        totalTokens: 5640,
      },
    ],
  };
}
