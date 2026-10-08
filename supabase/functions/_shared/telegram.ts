export type Button = { text: string; callback_data?: string; url?: string; web_app?: { url: string } };
export type SendOpts = { html?: boolean; replyKeyboard?: string[][] };

export interface Tg {
  sendMessage(chatId: number, text: string, buttons?: Button[][], opts?: SendOpts): Promise<{ message_id: number }>;
  editMessage(chatId: number, messageId: number, text: string, buttons?: Button[][], opts?: SendOpts): Promise<void>;
  answerCallback(id: string, text?: string): Promise<void>;
  deleteMessage(chatId: number, messageId: number): Promise<void>;
}

/** Счёт в Telegram Stars (XTR). subscriptionPeriod — только 30 дней (2592000), Telegram продлевает сам. */
export type Invoice = { title: string; description: string; payload: string; stars: number; subscriptionPeriod?: number };

export interface Payments {
  createInvoiceLink(inv: Invoice): Promise<string>;
  answerPreCheckoutQuery(id: string, ok: boolean, error?: string): Promise<void>;
}

export function telegramClient(token: string, fetchFn: typeof fetch = fetch): Tg & Payments {
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
    createInvoiceLink: async (inv) =>
      await call("createInvoiceLink", {
        title: inv.title,
        description: inv.description,
        payload: inv.payload,
        currency: "XTR",
        prices: [{ label: inv.title, amount: inv.stars }],
        ...(inv.subscriptionPeriod ? { subscription_period: inv.subscriptionPeriod } : {}),
      }) as string,
    answerPreCheckoutQuery: async (id, ok, error) => {
      await call("answerPreCheckoutQuery", { pre_checkout_query_id: id, ok, ...(ok || !error ? {} : { error_message: error }) });
    },
    deleteMessage: async (chatId, messageId) => {
      // Сообщение могли удалить руками или оно слишком старое — это не ошибка.
      try {
        await call("deleteMessage", { chat_id: chatId, message_id: messageId });
      } catch {
        // уже нет — и хорошо
      }
    },
  };
}
