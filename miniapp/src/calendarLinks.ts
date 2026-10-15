/**
 * Ссылки для подписки на календарь. Календари берут адрес по схеме webcal:// — так
 * iPhone понимает, что это подписка, а не разовый файл; Google принимает его в cid.
 */
export const webcal = (url: string) => url.replace(/^https?:\/\//, "webcal://");
export const googleSubscribe = (url: string) =>
  `https://calendar.google.com/calendar/r?cid=${encodeURIComponent(webcal(url))}`;
