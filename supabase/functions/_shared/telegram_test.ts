import { assert, assertRejects, assertEquals } from "jsr:@std/assert@1";
import { telegramClient } from "./telegram.ts";

Deno.test("network failure does not leak bot token", async () => {
  const fetchFn = (() => {
    throw new TypeError("error sending request for url (https://api.telegram.org/botSECRET123/sendMessage)");
  }) as unknown as typeof fetch;
  const tg = telegramClient("SECRET123", fetchFn);
  const err = await assertRejects(() => tg.sendMessage(1, "hi"));
  assert(!(err as Error).message.includes("SECRET123"));
  assert((err as Error).message.includes("sendMessage"));
});

Deno.test("sendMessage with replyKeyboard sends persistent keyboard", async () => {
  const bodies: Record<string, unknown>[] = [];
  const fetchFn = ((_url: string, init: RequestInit) => {
    bodies.push(JSON.parse(String(init.body)));
    return Promise.resolve(new Response(JSON.stringify({ ok: true, result: { message_id: 1 } })));
  }) as typeof fetch;
  await telegramClient("T", fetchFn).sendMessage(1, "hi", undefined, { replyKeyboard: [["A", "B"], ["C"]] });
  assertEquals(bodies[0].reply_markup, {
    keyboard: [[{ text: "A" }, { text: "B" }], [{ text: "C" }]],
    resize_keyboard: true,
    is_persistent: true,
  });
});

Deno.test("html option sets parse_mode on send and edit", async () => {
  const bodies: Record<string, unknown>[] = [];
  const fetchFn = ((_url: string, init: RequestInit) => {
    bodies.push(JSON.parse(String(init.body)));
    return Promise.resolve(new Response(JSON.stringify({ ok: true, result: { message_id: 1 } })));
  }) as typeof fetch;
  const tg = telegramClient("T", fetchFn);
  await tg.sendMessage(1, "<b>x</b>", [[{ text: "k", callback_data: "c" }]], { html: true });
  await tg.editMessage(1, 2, "<b>y</b>", undefined, { html: true });
  assertEquals(bodies[0].parse_mode, "HTML");
  assertEquals(bodies[0].reply_markup, { inline_keyboard: [[{ text: "k", callback_data: "c" }]] });
  assertEquals(bodies[1].parse_mode, "HTML");
});
