import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import type { Daily, DueDigest, Reminder, ReviewPing, SleepingQueue, Weekly } from "./render.ts";
import type { NotifyDb } from "./run.ts";

// deno-lint-ignore no-explicit-any
function check<T>(r: { data: T; error: any }): T {
  if (r.error) throw r.error;
  return r.data;
}

export function supabaseNotifyDb(sb: SupabaseClient): NotifyDb {
  return {
    dueReminders: async () => check(await sb.rpc("due_reminders")) as Reminder[],
    markReminded: async (ids) => { check(await sb.rpc("mark_reminded", { p_items: ids })); },
    dueDigests: async () => check(await sb.rpc("due_digests")) as DueDigest[],
    markDigest: async (u, k, on) => { check(await sb.rpc("mark_digest", { p_user: u, p_kind: k, p_on: on })); },
    daily: async (u, on) => check(await sb.rpc("digest_daily", { p_user: u, p_day: on })) as Daily,
    weekly: async (u, on) => check(await sb.rpc("digest_weekly", { p_user: u, p_day: on })) as Weekly,
    staleReviews: async () => check(await sb.rpc("stale_reviews")) as ReviewPing[],
    markReviewPinged: async (ids) => { check(await sb.rpc("mark_review_pinged", { p_inbox: ids })); },
    sleepingQueues: async () => check(await sb.rpc("sleeping_queues")) as SleepingQueue[],
    markQueueWarned: async (ids) => { check(await sb.rpc("mark_queue_warned", { p_users: ids })); },
    purgeUpdates: async () => { check(await sb.rpc("purge_tg_updates")); },
  };
}
