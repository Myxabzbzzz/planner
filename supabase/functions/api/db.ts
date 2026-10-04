import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

export type ApiUser = { id: string; is_allowed: boolean; onboarded_at: string | null };

export interface ApiDb {
  userByTg(tgId: number): Promise<ApiUser | null>;
  call(fn: string, args: unknown[]): Promise<unknown>;
}

const ARG_NAMES: Record<string, string[]> = {
  summary_today: ["p_user"],
  api_me: ["p_user"],
  api_tasks: ["p_user", "p_filter"],
  api_events: ["p_user", "p_from", "p_to"],
  api_money: ["p_user", "p_month"],
  api_habits: ["p_user", "p_weeks"],
  api_notes: ["p_user", "p_q", "p_before"],
  set_item_done: ["p_user", "p_item", "p_kind", "p_done"],
  set_habit_today: ["p_user", "p_habit", "p_done"],
  update_transaction: ["p_user", "p_id", "p_amount", "p_title", "p_category"],
  delete_transaction: ["p_user", "p_id"],
  api_categories: ["p_user"],
  update_task: ["p_user", "p_id", "p_title", "p_due_date", "p_due_time", "p_clear_due"],
  update_event: ["p_user", "p_id", "p_title", "p_date", "p_time", "p_with_whom"],
  delete_item: ["p_user", "p_id", "p_kind"],
  update_note: ["p_user", "p_id", "p_text", "p_kind"],
  delete_note: ["p_user", "p_id"],
  update_habit: ["p_user", "p_id", "p_name", "p_target"],
  archive_habit: ["p_user", "p_id"],
};

export function supabaseApiDb(sb: SupabaseClient): ApiDb {
  return {
    async userByTg(tgId) {
      const { data, error } = await sb.from("users").select("id,is_allowed,onboarded_at").eq("tg_id", tgId).maybeSingle();
      if (error) throw error;
      return data as ApiUser | null;
    },
    async call(fn, args) {
      const names = ARG_NAMES[fn];
      if (!names) throw new Error(`unknown rpc ${fn}`);
      const { data, error } = await sb.rpc(fn, Object.fromEntries(names.map((n, i) => [n, args[i]])));
      if (error) throw error;
      return data;
    },
  };
}
