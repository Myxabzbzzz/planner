import { createClient } from "npm:@supabase/supabase-js@2";
import { supabaseCaptureDb } from "./db.ts";
import { handleCapture } from "./handler.ts";

const db = supabaseCaptureDb(createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!));

Deno.serve(async (req) => {
  try {
    return await handleCapture(req, db);
  } catch (e) {
    console.error("capture failed:", e instanceof Error ? e.name : "unknown");
    return new Response(JSON.stringify({ message: "Ошибка, попробуй ещё раз" }), {
      status: 500,
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  }
});
