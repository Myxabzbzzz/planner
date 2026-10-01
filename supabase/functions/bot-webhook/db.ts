import { CURRENCIES } from "./currencies.ts";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

export type User = {
  id: string;
  tg_id: number;
  tg_username: string | null;
  is_allowed: boolean;
  is_admin: boolean;
  onboarded_at: string | null;
  base_currency: string | null;
};

export type NewInbox = {
  user_id: string;
  source: "text" | "voice";
  text?: string;
  audio_ref?: string;
  reply_chat_id: number;
  reply_message_id: number;
};

export interface Db {
  findUser(tgId: number): Promise<User | null>;
  createUser(u: Omit<User, "id" | "onboarded_at" | "base_currency"> & { name?: string }): Promise<User>;
  isInvited(username: string): Promise<boolean>;
  invite(username: string): Promise<void>;
  revoke(username: string): Promise<void>;
  onboard(userId: string, currency: string): Promise<void>;
  knownCurrency(code: string): Promise<boolean>;
  workerOnline(): Promise<boolean>;
  createInbox(row: NewInbox): Promise<string>;
  deleteRecords(userId: string, inboxId: string): Promise<number>;
  resolveReview(userId: string, inboxId: string, idx: number, kind: string): Promise<boolean>;
}

const USER_COLS = "id,tg_id,tg_username,is_allowed,is_admin,onboarded_at,base_currency";

// deno-lint-ignore no-explicit-any
function check<T>(r: { data: T; error: any }): T {
  if (r.error) throw r.error;
  return r.data;
}

export function supabaseDb(sb: SupabaseClient): Db {
  return {
    async findUser(tgId) {
      return check(await sb.from("users").select(USER_COLS).eq("tg_id", tgId).maybeSingle()) as User | null;
    },
    async createUser(u) {
      return check(await sb.from("users").insert(u).select(USER_COLS).single()) as User;
    },
    async isInvited(username) {
      return check(await sb.from("invites").select("username").eq("username", username).maybeSingle()) !== null;
    },
    async invite(username) {
      check(await sb.from("invites").upsert({ username }));
      check(await sb.from("users").update({ is_allowed: true }).eq("tg_username", username));
    },
    async revoke(username) {
      check(await sb.from("invites").delete().eq("username", username));
      check(await sb.from("users").update({ is_allowed: false }).eq("tg_username", username).eq("is_admin", false));
    },
    async onboard(userId, currency) {
      check(await sb.rpc("onboard_user", { p_user_id: userId, p_currency: currency }));
    },
    async knownCurrency(code) {
      const row = check(
        await sb.from("fx_rates").select("rates").order("date", { ascending: false }).limit(1).maybeSingle(),
      ) as { rates: Record<string, number> } | null;
      return row ? Object.hasOwn(row.rates, code) : CURRENCIES.includes(code);
    },
    async workerOnline() {
      return check(await sb.rpc("worker_online")) === true;
    },
    async createInbox(row) {
      return (check(await sb.from("inbox").insert(row).select("id").single()) as { id: string }).id;
    },
    async deleteRecords(userId, inboxId) {
      return check(await sb.rpc("delete_inbox_records", { p_user: userId, p_inbox: inboxId })) as number;
    },
    async resolveReview(userId, inboxId, idx, kind) {
      return check(
        await sb.rpc("resolve_review", { p_user: userId, p_inbox: inboxId, p_idx: idx, p_kind: kind }),
      ) === true;
    },
  };
}
