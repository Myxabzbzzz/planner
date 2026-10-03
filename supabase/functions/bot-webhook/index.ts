import { createClient } from "npm:@supabase/supabase-js@2";
import { handleUpdate } from "./handlers.ts";
import { supabaseDb } from "./db.ts";
import { supabaseMenuDb } from "./menu_db.ts";
import { telegramClient } from "../_shared/telegram.ts";

const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const deps = {
  db: supabaseDb(sb),
  tg: telegramClient(Deno.env.get("TELEGRAM_BOT_TOKEN")!),
  adminTgId: Number(Deno.env.get("ADMIN_TG_ID")),
  openAccess: Deno.env.get("OPEN_ACCESS") === "true",
  menu: supabaseMenuDb(sb),
  supabaseUrl: Deno.env.get("SUPABASE_URL")!,
  miniappUrl: Deno.env.get("MINIAPP_URL") ?? undefined,
};
const secret = Deno.env.get("TELEGRAM_WEBHOOK_SECRET")!;

Deno.serve(async (req) => {
  if (req.method !== "POST" || req.headers.get("x-telegram-bot-api-secret-token") !== secret) {
    return new Response("forbidden", { status: 403 });
  }
  const update = await req.json();
  try {
    await handleUpdate(update, deps);
  } catch (e) {
    console.error("update failed", update?.update_id, e);
  }
  return new Response("ok");
});
