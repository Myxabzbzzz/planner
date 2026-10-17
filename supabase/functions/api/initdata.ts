const enc = new TextEncoder();

async function hmac(key: Uint8Array<ArrayBuffer>, data: string): Promise<Uint8Array<ArrayBuffer>> {
  const k = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", k, enc.encode(data)));
}

const hex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, "0")).join("");

function dataCheckString(params: URLSearchParams): string {
  return [...params.entries()]
    .filter(([k]) => k !== "hash")
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");
}

/** Ключ подписи зависит только от токена бота — выводим его один раз, а не на каждый запрос. */
const keys = new Map<string, Promise<CryptoKey>>();
const keyFor = (botToken: string) => {
  let k = keys.get(botToken);
  if (!k) {
    k = hmac(enc.encode("WebAppData"), botToken)
      .then((secret) => crypto.subtle.importKey("raw", secret, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]));
    keys.set(botToken, k);
  }
  return k;
};

async function signature(params: URLSearchParams, botToken: string): Promise<string> {
  return hex(new Uint8Array(await crypto.subtle.sign("HMAC", await keyFor(botToken), enc.encode(dataCheckString(params)))));
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Окна жизни initData. Раньше было одно на всё — сутки, и утёкшая строка давала
 * сутки полного доступа, включая удаление. Теперь чтение живёт долго (миниапп
 * могут не закрывать полдня), а всё, что меняет данные, требует свежей сессии.
 */
export const MAX_AGE_READ = 86_400;
export const MAX_AGE_WRITE = 6 * 3600;
export const MAX_AGE_SENSITIVE = 3600;

export type Auth = { tgId: number; authDate: number };

export async function verifyInitData(
  initData: string,
  botToken: string,
  nowSec: number,
  maxAgeSec = MAX_AGE_READ,
): Promise<Auth | null> {
  if (!initData || !botToken) return null;
  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash) return null;
  if (!safeEqual(await signature(params, botToken), hash.toLowerCase())) return null;
  const authDate = Number(params.get("auth_date"));
  if (!Number.isFinite(authDate) || authDate <= 0 || nowSec - authDate > maxAgeSec || authDate > nowSec + 300) return null;
  try {
    const user = JSON.parse(params.get("user") ?? "null");
    return typeof user?.id === "number" ? { tgId: user.id, authDate } : null;
  } catch {
    return null;
  }
}

/** Только для тестов: собирает initData с верной подписью. */
export async function signInitData(fields: Record<string, string>, botToken: string): Promise<string> {
  const params = new URLSearchParams(fields);
  params.set("hash", await signature(params, botToken));
  return params.toString();
}
