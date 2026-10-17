/**
 * Свой токен сессии поверх initData.
 *
 * initData обновляется только при новом запуске миниаппа. Свёрнутый и снова
 * развёрнутый миниапп живёт со старой строкой, и через 6 часов он переставал
 * сохранять, а через сутки — даже читать («Сессия устарела»).
 *
 * Поэтому со свежей initData (не старше часа) сервер выдаёт токен, а клиент
 * шлёт его рядом с initData. Токен живёт 7 дней с последнего продления и
 * продлевается, пока им пользуются, но не дольше 30 дней от исходного входа —
 * дальше нужен новый запуск миниаппа. Необратимые действия токен не открывает:
 * им по-прежнему нужна initData не старше часа.
 *
 * Формат: `v1.<tg_id>.<iat>.<orig>.<hmac>` — без хранения в базе. Ключ выводится
 * из токена бота, отдельный секрет на деплое не нужен; смена токена бота
 * отзывает все сессии разом.
 */

const enc = new TextEncoder();

/** Токен без продления умирает через неделю. */
export const SESSION_TTL = 7 * 86_400;
/** Продлеваем не на каждом запросе, а раз в сутки. */
export const SESSION_RENEW_AFTER = 86_400;
/** Цепочка продлений не длиннее месяца от входа по свежей initData. */
export const SESSION_MAX = 30 * 86_400;
/** Выдаём токен только по свежей initData — утёкшая старая строка его не даст. */
export const SESSION_MINT_MAX_INIT_AGE = 3600;

export type Session = { tgId: number; iat: number; orig: number };

/** Ключ выводится из токена бота — один раз на токен, а не на каждый запрос. */
const keys = new Map<string, Promise<CryptoKey>>();

async function deriveKey(botToken: string): Promise<CryptoKey> {
  const keyBytes = await crypto.subtle.sign(
    "HMAC",
    await crypto.subtle.importKey("raw", enc.encode("planner-session-v1"), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]),
    enc.encode(botToken),
  );
  return await crypto.subtle.importKey("raw", keyBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
}

async function sign(botToken: string, payload: string): Promise<string> {
  let key = keys.get(botToken);
  if (!key) keys.set(botToken, key = deriveKey(botToken));
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", await key, enc.encode(payload)));
  return [...mac].map((x) => x.toString(16).padStart(2, "0")).join("");
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function mintSession(s: Session, botToken: string): Promise<string> {
  const payload = `v1.${s.tgId}.${s.iat}.${s.orig}`;
  return `${payload}.${await sign(botToken, payload)}`;
}

export async function verifySession(token: string, botToken: string, nowSec: number): Promise<Session | null> {
  if (!token || !botToken || token.length > 200) return null;
  const m = /^v1\.(\d{1,20})\.(\d{1,12})\.(\d{1,12})\.([0-9a-f]{64})$/.exec(token);
  if (!m) return null;
  const [, tg, iatS, origS, mac] = m;
  if (!safeEqual(await sign(botToken, `v1.${tg}.${iatS}.${origS}`), mac)) return null;
  const tgId = Number(tg);
  const iat = Number(iatS);
  const orig = Number(origS);
  if (!Number.isSafeInteger(tgId) || orig > iat || iat > nowSec + 300) return null;
  if (nowSec - iat > SESSION_TTL || nowSec - orig > SESSION_MAX) return null;
  return { tgId, iat, orig };
}
