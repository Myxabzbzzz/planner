export type Button = { text: string; callback_data?: string; url?: string };

export interface Tg {
  sendMessage(chatId: number, text: string, buttons?: Button[][]): Promise<{ message_id: number }>;
  editMessage(chatId: number, messageId: number, text: string, buttons?: Button[][]): Promise<void>;
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
  const markup = (b?: Button[][]) => (b ? { reply_markup: { inline_keyboard: b } } : {});
  return {
    sendMessage: (chatId, text, buttons) => call("sendMessage", { chat_id: chatId, text, ...markup(buttons) }),
    editMessage: async (chatId, messageId, text, buttons) => {
      await call("editMessageText", { chat_id: chatId, message_id: messageId, text, ...markup(buttons) });
    },
    answerCallback: async (id, text) => {
      await call("answerCallbackQuery", { callback_query_id: id, ...(text ? { text } : {}) });
    },
  };
}
