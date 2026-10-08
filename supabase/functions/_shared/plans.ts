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

export const PRO_PITCH = "Безлимит голосовых и вопросов к ИИ, итоги недели по воскресеньям, запись с кнопки iPhone.";

export const planPayload = (plan: Plan) => `pro:${plan}`;

export function planFromPayload(payload: unknown): Plan | null {
  const m = typeof payload === "string" ? /^pro:([a-z]+)$/.exec(payload) : null;
  return m && Object.hasOwn(PLANS, m[1]) ? m[1] as Plan : null;
}

export function invoiceFor(plan: Plan): Invoice {
  const p = PLANS[plan];
  return {
    title: `Планер ${p.title}`,
    description: PRO_PITCH,
    payload: planPayload(plan),
    stars: p.stars,
    ...("subscriptionPeriod" in p ? { subscriptionPeriod: p.subscriptionPeriod } : {}),
  };
}

/** Ссылки на оплату всех тарифов, в порядке PLAN_IDS. */
export async function invoiceLinks(pay: Payments): Promise<Record<Plan, string>> {
  const links = await Promise.all(PLAN_IDS.map((p) => pay.createInvoiceLink(invoiceFor(p))));
  return Object.fromEntries(PLAN_IDS.map((p, i) => [p, links[i]])) as Record<Plan, string>;
}
