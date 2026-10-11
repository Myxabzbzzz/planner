import { assertEquals } from "jsr:@std/assert@1";
import { mintSession, SESSION_MAX, SESSION_TTL, verifySession } from "./session.ts";

const TOKEN = "123:ABC";
const NOW = 1_790_900_000;

Deno.test("сессия: выданный токен проверяется", async () => {
  const t = await mintSession({ tgId: 7, iat: NOW, orig: NOW }, TOKEN);
  assertEquals(await verifySession(t, TOKEN, NOW + 60), { tgId: 7, iat: NOW, orig: NOW });
});

Deno.test("сессия: чужая подпись, подмена id и мусор не проходят", async () => {
  const t = await mintSession({ tgId: 7, iat: NOW, orig: NOW }, TOKEN);
  assertEquals(await verifySession(t, "999:OTHER", NOW), null);
  assertEquals(await verifySession(t.replace("v1.7.", "v1.8."), TOKEN, NOW), null);
  for (const bad of ["", "v1", "v1.7.1.1.zz", `${t}0`, "x".repeat(500)]) {
    assertEquals(await verifySession(bad, TOKEN, NOW), null, bad);
  }
});

Deno.test("сессия: без продления умирает через неделю", async () => {
  const t = await mintSession({ tgId: 7, iat: NOW, orig: NOW }, TOKEN);
  assertEquals((await verifySession(t, TOKEN, NOW + SESSION_TTL))?.tgId, 7);
  assertEquals(await verifySession(t, TOKEN, NOW + SESSION_TTL + 1), null);
});

Deno.test("сессия: продления не тянут её дольше месяца от входа", async () => {
  const t = await mintSession({ tgId: 7, iat: NOW + SESSION_MAX, orig: NOW }, TOKEN);
  assertEquals((await verifySession(t, TOKEN, NOW + SESSION_MAX))?.tgId, 7);
  assertEquals(await verifySession(t, TOKEN, NOW + SESSION_MAX + 1), null);
});

Deno.test("сессия: из будущего и с orig позже iat — нет", async () => {
  assertEquals(await verifySession(await mintSession({ tgId: 7, iat: NOW + 3600, orig: NOW }, TOKEN), TOKEN, NOW), null);
  assertEquals(await verifySession(await mintSession({ tgId: 7, iat: NOW, orig: NOW + 1 }, TOKEN), TOKEN, NOW), null);
});
