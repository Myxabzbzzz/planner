/**
 * Тестовый бот в тестовой среде Telegram — чтобы проверить оплату звёздами без денег.
 *
 * Забирает апдейты тестового бота через getUpdates и отдаёт их локальной функции
 * bot-webhook (supabase functions serve). Публичный адрес и вебхук не нужны, прод не трогается.
 *
 *   deno run --allow-net --allow-env --env-file=supabase/functions/.env.test scripts/tg-test-bot.ts
 */
const token = Deno.env.get("TELEGRAM_BOT_TOKEN");
const secret = Deno.env.get("TELEGRAM_WEBHOOK_SECRET");
const target = Deno.env.get("LOCAL_WEBHOOK_URL") ?? "http://127.0.0.1:54321/functions/v1/bot-webhook";
if (!token || !secret) throw new Error("нужны TELEGRAM_BOT_TOKEN и TELEGRAM_WEBHOOK_SECRET в supabase/functions/.env.test");
if (Deno.env.get("TELEGRAM_TEST_ENV") !== "true") throw new Error("это скрипт для тестовой среды: TELEGRAM_TEST_ENV=true");

const api = (method: string) => `https://api.telegram.org/bot${token}/test/${method}`;
const post = (method: string, body: unknown = {}) =>
  fetch(api(method), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })
    .then((r) => r.json());

// getUpdates не работает, пока у бота стоит вебхук
await post("deleteWebhook");
const me = await post("getMe");
if (!me.ok) throw new Error(`тестовый бот не отвечает: ${me.description}`);
console.log(`@${me.result.username} в тестовой среде → ${target}`);

let offset = 0;
for (;;) {
  const r = await post("getUpdates", {
    offset, timeout: 30, allowed_updates: ["message", "callback_query", "pre_checkout_query"],
  }).catch((e) => ({ ok: false, description: String(e) }));
  if (!r.ok) {
    console.error("getUpdates:", r.description);
    await new Promise((res) => setTimeout(res, 3000));
    continue;
  }
  for (const u of r.result) {
    offset = u.update_id + 1;
    const kind = Object.keys(u).find((k) => k !== "update_id");
    const res = await fetch(target, {
      method: "POST",
      headers: { "content-type": "application/json", "x-telegram-bot-api-secret-token": secret },
      body: JSON.stringify(u),
    }).catch((e) => ({ status: String(e) }));
    console.log(u.update_id, kind, res.status);
  }
}
