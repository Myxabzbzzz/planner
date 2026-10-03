import { createClient } from "npm:@supabase/supabase-js@2";
import { telegramClient } from "../_shared/telegram.ts";
import { supabaseNotifyDb } from "./db.ts";
import { runNotify } from "./run.ts";

const secret = Deno.env.get("CRON_SECRET") ?? "";
const token = Deno.env.get("TELEGRAM_BOT_TOKEN") ?? "";
const db = supabaseNotifyDb(createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!));
const tg = telegramClient(token);
const miniappUrl = Deno.env.get("MINIAPP_URL") || undefined;

Deno.serve(async (req) => {
  if (!secret || !token) return new Response("misconfigured", { status: 500 });
  if (req.headers.get("x-cron-secret") !== secret) return new Response("forbidden", { status: 403 });
  try {
    return Response.json(await runNotify({ db, tg, miniappUrl }));
  } catch (e) {
    console.error("notify failed:", e instanceof Error ? e.message : String(e));
    return new Response("error", { status: 500 });
  }
});
