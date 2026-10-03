export type Button = { text: string; callback_data?: string; url?: string; web_app?: { url: string } };
export type SendOpts = { html?: boolean; replyKeyboard?: string[][] };

export interface Tg {
  sendMessage(chatId: number, text: string, buttons?: Button[][], opts?: SendOpts): Promise<{ message_id: number }>;
  editMessage(chatId: number, messageId: number, text: string, buttons?: Button[][], opts?: SendOpts): Promise<void>;
  answerCallback(id: string, text?: string): Promise<void>;
}

export function telegramClient(token: string, fetchFn: typeof fetch = fetch): Tg {
  async function call(method: string, body: unknown) {
    let json;
    try {
      const res = await fetchFn(`https://api.telegram.org/bot${token}/${method}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      json = await res.json();
    } catch {
      // the original error text contains the URL (and the bot token)
      throw new Error(`telegram ${method}: network error`);
    }
    if (!json.ok) throw new Error(`telegram ${method}: ${json.description}`);
    return json.result;
  }
  const extras = (b?: Button[][], o?: SendOpts, allowReply = true) => ({
    ...(o?.html ? { parse_mode: "HTML" } : {}),
    ...(allowReply && o?.replyKeyboard
      ? { reply_markup: { keyboard: o.replyKeyboard.map((r) => r.map((text) => ({ text }))), resize_keyboard: true, is_persistent: true } }
      : b ? { reply_markup: { inline_keyboard: b } } : {}),
  });
  return {
    sendMessage: (chatId, text, buttons, opts) =>
      call("sendMessage", { chat_id: chatId, text, ...extras(buttons, opts) }),
    editMessage: async (chatId, messageId, text, buttons, opts) => {
      await call("editMessageText", { chat_id: chatId, message_id: messageId, text, ...extras(buttons, opts, false) });
    },
    answerCallback: async (id, text) => {
      await call("answerCallbackQuery", { callback_query_id: id, ...(text ? { text } : {}) });
    },
  };
}
