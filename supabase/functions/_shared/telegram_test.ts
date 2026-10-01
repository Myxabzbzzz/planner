import { assert, assertRejects } from "jsr:@std/assert@1";
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
