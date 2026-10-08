import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { LIMITS } from "../_shared/limits.ts";

export type CaptureUser = { id: string; tg_id: number; is_allowed: boolean; onboarded_at: string | null };
export type CaptureRow = { user_id: string; source: "shortcut"; text: string; reply_chat_id: number };

export interface CaptureDb {
  userByToken(token: string): Promise<CaptureUser | null>;
  workerOnline(): Promise<boolean>;
  /** false — лимит исчерпан; сбой самой проверки пропускает запись. */
  rateLimit(userId: string): Promise<boolean>;
  isPro(userId: string): Promise<boolean>;
  createInbox(row: CaptureRow): Promise<void>;
}

// deno-lint-ignore no-explicit-any
function check<T>(r: { data: T; error: any }): T {
  if (r.error) throw r.error;
  return r.data;
}

export function supabaseCaptureDb(sb: SupabaseClient): CaptureDb {
  return {
    async userByToken(token) {
      return check(
        await sb.from("users").select("id,tg_id,is_allowed,onboarded_at").eq("capture_token", token).maybeSingle(),
      ) as CaptureUser | null;
    },
    async workerOnline() {
      return check(await sb.rpc("worker_online")) === true;
    },
    async rateLimit(userId) {
      const { limit, window } = LIMITS.inbox;
      try {
        return check(await sb.rpc("rate_limit", { p_user: userId, p_action: "inbox", p_limit: limit, p_window: window })) !== false;
      } catch {
        return true;
      }
    },
    async isPro(userId) {
      return check(await sb.rpc("is_pro", { p_user: userId })) === true;
    },
    async createInbox(row) {
      check(await sb.from("inbox").insert(row));
    },
  };
}
