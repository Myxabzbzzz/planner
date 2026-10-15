import { createClient } from "npm:@supabase/supabase-js@2";
import { handleCalendar } from "./handler.ts";
import type { Feed } from "./ics.ts";

const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const appUrl = Deno.env.get("MINIAPP_URL") ?? undefined;

Deno.serve((req) =>
  handleCalendar(req, {
    async feed(token) {
      const { data, error } = await sb.rpc("calendar_feed", { p_token: token });
      if (error) throw error;
      return data as Feed | null;
    },
  }, new Date(), appUrl)
);
