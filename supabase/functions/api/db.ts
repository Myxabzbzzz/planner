import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

export type ApiUser = { id: string; is_allowed: boolean; onboarded_at: string | null };
export type InboxInsert = {
  user_id: string; source: "miniapp"; text: string | null; audio_ref: string | null; reply_chat_id: number;
};

export interface ApiDb {
  userByTg(tgId: number): Promise<ApiUser | null>;
  call(fn: string, args: unknown[]): Promise<unknown>;
  createInbox(row: InboxInsert): Promise<string>;
  workerOnline(): Promise<boolean>;
  uploadAudio(path: string, bytes: Uint8Array, contentType: string): Promise<void>;
  removeAudio(path: string): Promise<void>;
}

export const ARG_NAMES: Record<string, string[]> = {
  summary_today: ["p_user"],
  api_me: ["p_user"],
  api_subscription: ["p_user"],
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
  api_inbox_status: ["p_user", "p_id"],
  api_profile: ["p_user", "p_months"],
  api_settings: ["p_user"],
  api_set_limit: ["p_user", "p_amount"],
  api_set_notify: ["p_user", "p_kind", "p_on"],
  set_habit_on: ["p_user", "p_habit", "p_date", "p_done"],
  unarchive_habit: ["p_user", "p_id"],
  create_task: ["p_user", "p_title", "p_due_date", "p_due_time"],
  create_event: ["p_user", "p_title", "p_date", "p_time", "p_with_whom"],
  create_note: ["p_user", "p_text", "p_kind"],
  create_habit: ["p_user", "p_name", "p_target"],
  create_transaction: ["p_user", "p_type", "p_amount", "p_title", "p_category", "p_date"],
  restore_item: ["p_user", "p_id", "p_kind"],
  restore_note: ["p_user", "p_id"],
  restore_transaction: ["p_user", "p_id"],
  edit_transaction: ["p_user", "p_id", "p_amount", "p_title", "p_category", "p_date", "p_type", "p_currency"],
  api_operations: ["p_user", "p_month", "p_before"],
  api_budgets: ["p_user", "p_month"],
  set_category_limit: ["p_user", "p_category", "p_amount"],
  rename_category: ["p_user", "p_id", "p_name"],
  delete_category: ["p_user", "p_id"],
  set_category_color: ["p_user", "p_id", "p_color"],
  api_reviews: ["p_user"],
  resolve_review: ["p_user", "p_inbox", "p_idx", "p_kind"],
  resolve_time: ["p_user", "p_inbox", "p_idx", "p_choice"],
  change_base_currency: ["p_user", "p_cur"],
  export_data: ["p_user"],
  delete_account: ["p_user"],
  rate_limit: ["p_user", "p_action", "p_limit", "p_window"],
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
    async createInbox(row) {
      const { data, error } = await sb.from("inbox").insert(row).select("id").single();
      if (error) throw error;
      return (data as { id: string }).id;
    },
    async workerOnline() {
      const { data, error } = await sb.rpc("worker_online");
      if (error) throw error;
      return data === true;
    },
    async uploadAudio(path, bytes, contentType) {
      const { error } = await sb.storage.from("audio").upload(path, bytes, { contentType, upsert: false });
      if (error) throw error;
    },
    async removeAudio(path) {
      const { error } = await sb.storage.from("audio").remove([path]);
      if (error) throw error;
    },
  };
}
