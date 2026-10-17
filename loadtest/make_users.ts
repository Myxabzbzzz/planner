/**
 * Подписанная initData для каждого тестового пользователя из seed.sql — тем же кодом, что проверяет API.
 * Токен бота — локальный, из loadtest/functions.env: прод такую подпись не примет.
 *
 *   deno run --allow-read --allow-write --allow-env loadtest/make_users.ts 500
 */
import { signInitData } from "../supabase/functions/api/initdata.ts";

const n = Number(Deno.args[0] ?? "500");
const env = await Deno.readTextFile(new URL("./functions.env", import.meta.url));
const token = /^TELEGRAM_BOT_TOKEN=(.+)$/m.exec(env)?.[1]?.trim();
if (!token) throw new Error("нет TELEGRAM_BOT_TOKEN в loadtest/functions.env");

// auth_date «сейчас»: запись в API принимает подпись не старше 6 часов — тест надо прогнать в это окно
const authDate = String(Math.floor(Date.now() / 1000));
const users: string[] = [];
for (let i = 1; i <= n; i++) {
  const user = JSON.stringify({ id: 900000000 + i, first_name: `Нагрузка ${i}` });
  users.push(await signInitData({ auth_date: authDate, user }, token));
}
await Deno.writeTextFile(new URL("./users.json", import.meta.url), JSON.stringify(users));
console.log(`users.json: ${n} подписей, годны для записи до ${new Date((+authDate + 6 * 3600) * 1000).toLocaleString("ru")}`);
