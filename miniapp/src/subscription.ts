import type { SubPlan, Subscription } from "./types";

const day = (local: string | null) => (local ? `${local.slice(8, 10)}.${local.slice(5, 7)}` : "");

/** Что показать в профиле и в шторке подписки. */
export function subStatus(s: Omit<Subscription, "plans"> & { plans?: SubPlan[] }): { title: string; hint: string; pro: boolean } {
  switch (s.status) {
    case "lifetime":
      return { title: "Pro навсегда", hint: "Спасибо, что поддержал проект на старте", pro: true };
    case "pro":
      return { title: `Pro до ${day(s.pro_until)}`, hint: "Безлимит голосовых и вопросов к ИИ", pro: true };
    case "trial":
      return { title: `Пробный Pro до ${day(s.pro_until)}`, hint: `Потом — Free: ${s.ai_per_day} голосовых или вопроса в день`, pro: true };
    default:
      return {
        title: "Free",
        hint: `Сегодня осталось ${s.ai_left ?? 0} из ${s.ai_per_day} действий ИИ (голосовое или вопрос)`,
        pro: false,
      };
  }
}

export const planPrice = (p: SubPlan) => `${p.stars} ⭐${p.recurring ? ", автопродление" : " разово"}`;

/** Плашка на главном экране: видна на Free и в пробный период, после оплаты исчезает. */
export function proBanner(s: Subscription): { title: string; hint: string } | null {
  if (s.status === "pro" || s.status === "lifetime") return null;
  const from = s.plans.find((p) => p.recurring) ?? s.plans[0];
  const price = from ? ` · от ${from.stars} ⭐ в месяц` : "";
  if (s.status === "trial") {
    return { title: `Пробный Pro до ${day(s.pro_until)}`, hint: `Оформи, чтобы безлимит остался${price}` };
  }
  return { title: "Pro — голос и вопросы без лимита", hint: `Сегодня осталось ${s.ai_left ?? 0} из ${s.ai_per_day}${price}` };
}
