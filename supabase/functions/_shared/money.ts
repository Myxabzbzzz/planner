const SYMBOLS: Record<string, string> = { RUB: "₽", USD: "$", EUR: "€", UZS: "сум", KZT: "₸" };

export function fmtNumber(n: number): string {
  const [int, frac] = (Math.round(n * 100) / 100).toFixed(2).split(".");
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  return frac === "00" ? grouped : `${grouped},${frac}`;
}

export const fmtAmount = (n: number, cur: string) => `${fmtNumber(n)} ${SYMBOLS[cur] ?? cur}`;
