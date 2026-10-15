import type { Invoice, Payments } from "./telegram.ts";

/**
 * Тарифы Pro в Telegram Stars. Цифровые товары внутри Telegram продаются только за звёзды.
 * Месяц — подписка с автопродлением (Telegram умеет только 30 дней); год и «навсегда» — разовые покупки.
 * Цены подобраны под ≈280 ₽ / 2 090 ₽ / 4 190 ₽ — сверить с курсом звезды в @PremiumBot перед запуском.
 */
export const PLANS = {
  month: { stars: 150, title: "Pro · месяц", subscriptionPeriod: 2592000 },
  year: { stars: 1100, title: "Pro · год" },
  lifetime: { stars: 2200, title: "Founder · навсегда" },
} as const;

export type Plan = keyof typeof PLANS;
export const PLAN_IDS = Object.keys(PLANS) as Plan[];

/** «Навсегда» продаётся только первым покупателям — дефицит честный, мест правда столько. */
export const FOUNDER_SEATS = 100;

/** Тарифы, которые ещё можно купить: когда места Founder кончились, его не показываем. */
export const plansOnSale = (founderSold: number): Plan[] =>
  PLAN_IDS.filter((p) => p !== "lifetime" || founderSold < FOUNDER_SEATS);

/** Сколько месяцев из двенадцати год даёт бесплатно по сравнению с помесячной оплатой. */
export const yearGiftMonths = () => Math.floor(12 - PLANS.year.stars / PLANS.month.stars);

/** Короткая приписка к тарифу: выгода года и остаток мест Founder. */
export function planNote(plan: Plan, founderSold: number): string | null {
  if (plan === "year") return `${yearGiftMonths()} месяца в подарок`;
  if (plan === "lifetime") return `осталось ${Math.max(FOUNDER_SEATS - founderSold, 0)} из ${FOUNDER_SEATS} мест`;
  return null;
}

export const PRO_PITCH = "Безлимит голосовых и вопросов к ИИ, итоги недели по воскресеньям.";

export const planPayload = (plan: Plan) => `pro:${plan}`;

export function planFromPayload(payload: unknown): Plan | null {
  const m = typeof payload === "string" ? /^pro:([a-z]+)$/.exec(payload) : null;
  return m && Object.hasOwn(PLANS, m[1]) ? m[1] as Plan : null;
}

export function invoiceFor(plan: Plan): Invoice {
  const p = PLANS[plan];
  return {
    title: `B&T Planner ${p.title}`,
    description: PRO_PITCH,
    payload: planPayload(plan),
    stars: p.stars,
    ...("subscriptionPeriod" in p ? { subscriptionPeriod: p.subscriptionPeriod } : {}),
  };
}

/** Ссылки на оплату тарифов, в том же порядке. */
export async function invoiceLinks(pay: Payments, plans: Plan[] = PLAN_IDS): Promise<Partial<Record<Plan, string>>> {
  const links = await Promise.all(plans.map((p) => pay.createInvoiceLink(invoiceFor(p))));
  return Object.fromEntries(plans.map((p, i) => [p, links[i]]));
}
