import { CURRENCIES } from "./currencies.ts";
import { type LimitAction, LIMITS } from "../_shared/limits.ts";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

export type User = {
  id: string;
  tg_id: number;
  tg_username: string | null;
  is_allowed: boolean;
  is_admin: boolean;
  onboarded_at: string | null;
  base_currency: string | null;
  pending_action?: string | null;
};

export type NewInbox = {
  user_id: string;
  source: "text" | "voice";
  text?: string;
  audio_ref?: string;
  reply_chat_id: number;
  reply_message_id?: number;
};

export type Queue = {
  waiting: number;
  needs_review: number;
  failed: number;
  oldest: string | null;
};

/** api_subscription: pro_until — локальное время пользователя; null у «навсегда» и у Free. */
export type Subscription = {
  status: "trial" | "pro" | "lifetime" | "free";
  pro_until: string | null;
  ai_left: number | null;
  ai_per_day: number;
};

export interface Db {
  resolveTime(userId: string, inboxId: string, idx: number, choice: string): Promise<boolean>;
  findUser(tgId: number): Promise<User | null>;
  createUser(u: Omit<User, "id" | "onboarded_at" | "base_currency"> & { name?: string }): Promise<User>;
  /** Запоминает апдейт; false — его уже обрабатывали (Telegram повторил при таймауте). */
  recordUpdate(updateId: number | undefined): Promise<boolean>;
  /** Ник в базе должен быть свежим, иначе `/deny @ник` бьёт мимо. */
  touchUser(tgId: number, username: string | null, name: string): Promise<void>;
  /** Одноразовое приглашение по нику или постоянное по tg_id. */
  claimInvite(tgId: number, username: string | null): Promise<boolean>;
  invite(username: string | null, tgId?: number): Promise<void>;
  revoke(username: string | null, tgId?: number): Promise<number>;
  onboard(userId: string, currency: string): Promise<void>;
  knownCurrency(code: string): Promise<boolean>;
  workerOnline(): Promise<boolean>;
  /** false — лимит исчерпан; сбой самой проверки пропускает запись. */
  rateLimit(userId: string, action: LimitAction): Promise<boolean>;
  createInbox(row: NewInbox): Promise<string>;
  setInboxReply(inboxId: string, messageId: number): Promise<void>;
  deleteRecords(userId: string, inboxId: string): Promise<number>;
  restoreRecords(userId: string, inboxId: string): Promise<number>;
  resolveReview(userId: string, inboxId: string, idx: number, kind: string): Promise<boolean>;
  retryInbox(userId: string, inboxId: string): Promise<boolean>;
  cancelInbox(userId: string, inboxId: string): Promise<boolean>;
  queue(userId: string): Promise<Queue>;
  /** false — этот платёж уже зачислен (Telegram прислал его повторно). */
  applyPayment(userId: string, chargeId: string, plan: string, stars: number, until: string | null,
               recurring: boolean): Promise<boolean>;
  subscription(userId: string): Promise<Subscription>;
}

const USER_COLS = "id,tg_id,tg_username,is_allowed,is_admin,onboarded_at,base_currency,pending_action";

// deno-lint-ignore no-explicit-any
function check<T>(r: { data: T; error: any }): T {
  if (r.error) throw r.error;
  return r.data;
}

export function supabaseDb(sb: SupabaseClient): Db {
  return {
    async resolveTime(userId, inboxId, idx, choice) {
      return check(
        await sb.rpc("resolve_time", { p_user: userId, p_inbox: inboxId, p_idx: idx, p_choice: choice }),
      ) === true;
    },
    async findUser(tgId) {
      return check(await sb.from("users").select(USER_COLS).eq("tg_id", tgId).maybeSingle()) as User | null;
    },
    async createUser(u) {
      return check(await sb.from("users").insert(u).select(USER_COLS).single()) as User;
    },
    async recordUpdate(updateId) {
      if (updateId === undefined || updateId === null) return true;
      return check(await sb.rpc("record_update", { p_update_id: updateId })) === true;
    },
    async touchUser(tgId, username, name) {
      check(await sb.rpc("touch_user", { p_tg_id: tgId, p_username: username, p_name: name }));
    },
    async claimInvite(tgId, username) {
      return check(await sb.rpc("claim_invite", { p_tg_id: tgId, p_username: username })) === true;
    },
    async invite(username, tgId) {
      check(await sb.rpc("invite_user", { p_username: username, p_tg_id: tgId ?? null }));
    },
    async revoke(username, tgId) {
      return Number(check(await sb.rpc("revoke_user", { p_username: username, p_tg_id: tgId ?? null })) ?? 0);
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
    async rateLimit(userId, action) {
      const { limit, window } = LIMITS[action];
      try {
        return check(await sb.rpc("rate_limit", { p_user: userId, p_action: action, p_limit: limit, p_window: window })) !== false;
      } catch {
        return true;
      }
    },
    async applyPayment(userId, chargeId, plan, stars, until, recurring) {
      return check(await sb.rpc("apply_payment", {
        p_user: userId, p_charge_id: chargeId, p_plan: plan, p_stars: stars, p_until: until, p_recurring: recurring,
      })) === true;
    },
    async subscription(userId) {
      return check(await sb.rpc("api_subscription", { p_user: userId })) as Subscription;
    },
    async createInbox(row) {
      return (check(await sb.from("inbox").insert(row).select("id").single()) as { id: string }).id;
    },
    async setInboxReply(inboxId, messageId) {
      check(await sb.from("inbox").update({ reply_message_id: messageId }).eq("id", inboxId));
    },
    async deleteRecords(userId, inboxId) {
      return check(await sb.rpc("delete_inbox_records", { p_user: userId, p_inbox: inboxId })) as number;
    },
    async restoreRecords(userId, inboxId) {
      return check(await sb.rpc("restore_inbox_records", { p_user: userId, p_inbox: inboxId })) as number;
    },
    async resolveReview(userId, inboxId, idx, kind) {
      return check(
        await sb.rpc("resolve_review", { p_user: userId, p_inbox: inboxId, p_idx: idx, p_kind: kind }),
      ) === true;
    },
    async retryInbox(userId, inboxId) {
      return check(await sb.rpc("retry_inbox", { p_user: userId, p_inbox: inboxId })) === true;
    },
    async cancelInbox(userId, inboxId) {
      return check(await sb.rpc("cancel_inbox", { p_user: userId, p_inbox: inboxId })) === true;
    },
    async queue(userId) {
      return check(await sb.rpc("inbox_queue", { p_user: userId })) as Queue;
    },
  };
}
