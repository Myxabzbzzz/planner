import { createClient } from "npm:@supabase/supabase-js@2";
import { parseErApi } from "./parse.ts";

const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const cronSecret = Deno.env.get("CRON_SECRET")!;

Deno.serve(async (req) => {
  if (req.headers.get("x-cron-secret") !== cronSecret) return new Response("forbidden", { status: 403 });
  const res = await fetch("https://open.er-api.com/v6/latest/USD");
  const { date, rates } = parseErApi(await res.json());
  const { error } = await sb.from("fx_rates").upsert({
    date,
    base: "USD",
    rates,
    source: "open.er-api.com",
    fetched_at: new Date().toISOString(),
  });
  if (error) {
    console.error("fx upsert failed", error);
    return new Response(error.message, { status: 500 });
  }
  return Response.json({ date, count: Object.keys(rates).length });
});
