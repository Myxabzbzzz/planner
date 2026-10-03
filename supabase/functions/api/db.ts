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
