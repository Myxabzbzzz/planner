import { createClient } from "npm:@supabase/supabase-js@2";
import { supabaseApiDb } from "./db.ts";
import { handleApi } from "./handler.ts";
import { telegramClient } from "../_shared/telegram.ts";

const botToken = Deno.env.get("TELEGRAM_BOT_TOKEN");
if (!botToken) throw new Error("TELEGRAM_BOT_TOKEN is not set");

const tg = telegramClient(botToken);
const deps = {
  db: supabaseApiDb(createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!)),
  botToken,
  pay: tg,
  files: tg,
  calendarBase: `${Deno.env.get("SUPABASE_URL")}/functions/v1/calendar/`,
  nowSec: () => Math.floor(Date.now() / 1000),
};

Deno.serve((req) => handleApi(req, deps));
