import { assertEquals } from "jsr:@std/assert@1";
import { signInitData, verifyInitData } from "./initdata.ts";

const TOKEN = "123:ABC";
const NOW = 1_790_900_000;

Deno.test("valid initData yields telegram id", async () => {
  const init = await signInitData({ auth_date: String(NOW - 60), user: JSON.stringify({ id: 482570103 }), query_id: "q" }, TOKEN);
  assertEquals(await verifyInitData(init, TOKEN, NOW), { tgId: 482570103, authDate: NOW - 60 });
});

Deno.test("tampered user is rejected", async () => {
  const init = await signInitData({ auth_date: String(NOW - 60), user: JSON.stringify({ id: 1 }) }, TOKEN);
  const forged = init.replace(encodeURIComponent(JSON.stringify({ id: 1 })), encodeURIComponent(JSON.stringify({ id: 2 })));
  assertEquals(await verifyInitData(forged, TOKEN, NOW), null);
});

Deno.test("wrong token, expired, missing hash or user are rejected", async () => {
  const ok = await signInitData({ auth_date: String(NOW - 60), user: JSON.stringify({ id: 1 }) }, TOKEN);
  assertEquals(await verifyInitData(ok, "999:ZZZ", NOW), null);
  const old = await signInitData({ auth_date: String(NOW - 90_000), user: JSON.stringify({ id: 1 }) }, TOKEN);
  assertEquals(await verifyInitData(old, TOKEN, NOW), null);
  assertEquals(await verifyInitData("auth_date=1&user=%7B%7D", TOKEN, NOW), null);
  const noUser = await signInitData({ auth_date: String(NOW - 60) }, TOKEN);
  assertEquals(await verifyInitData(noUser, TOKEN, NOW), null);
  assertEquals(await verifyInitData("", TOKEN, NOW), null);
});

Deno.test("empty or missing bot token is rejected (no fail-open)", async () => {
  const init = await signInitData({ auth_date: String(NOW - 60), user: JSON.stringify({ id: 1 }) }, "");
  assertEquals(await verifyInitData(init, "", NOW), null);
  assertEquals(await verifyInitData(init, undefined as unknown as string, NOW), null);
});

Deno.test("future auth_date is rejected", async () => {
  const init = await signInitData({ auth_date: String(NOW + 3600), user: JSON.stringify({ id: 1 }) }, TOKEN);
  assertEquals(await verifyInitData(init, TOKEN, NOW), null);
});
