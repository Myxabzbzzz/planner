import { useState } from "react";
import type { Api } from "../api";
import { fmtAmount } from "../format";
import { regularWhen } from "../forecast";
import { useLoad } from "../load";
import { saveError } from "../saveError";
import { hapticResult } from "../telegram";
import { ProTeaser } from "./ProTeaser";
import { RegularSheet } from "./RegularSheet";
import { Card } from "./States";

const plural = (n: number) => (n % 10 === 1 && n % 100 !== 11 ? "регулярный платёж"
  : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? "регулярных платежа" : "регулярных платежей");

/**
 * Регулярные платежи (Pro): подписки, связь, аренда. Найденные сами — с вопросом
 * «напоминать?», подтверждённые — с датой следующего списания. Накануне бот напомнит
 * и по кнопке запишет трату.
 */
export function RegularCard({ api, refresh, onPro, onChanged }: {
  api: Api; refresh: number; onPro: () => void; onChanged: () => void;
}) {
  const { data, reload } = useLoad(() => api.regular(), [api], refresh);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  if (!data) return null;
  if ("locked" in data) {
    return (
      <Card className="flush">
        <ProTeaser onPro={onPro}
          title={data.found > 0 ? `Нашёл ${data.found} ${plural(data.found)}` : "Регулярные платежи"}
          hint="Напомню за день до списания и запишу трату одной кнопкой" />
      </Card>
    );
  }

  async function act(id: string, action: () => Promise<unknown>) {
    setBusy(id);
    setError(null);
    try {
      await action();
      hapticResult(true);
      reload();
      onChanged();
    } catch (e) {
      hapticResult(false);
      setError(saveError(e));
    } finally {
      setBusy(null);
    }
  }

  const cur = data.base_currency;
  return (
    <Card className="flush">
      <div className="card-head" style={{ padding: "0 16px" }}>
        <h3 className="grow">Регулярные платежи</h3>
        <button type="button" className="btn quiet" style={{ minHeight: 32, padding: 0 }} onClick={() => setAdding(true)}>
          Добавить
        </button>
      </div>
      {data.items.length === 0 && (
        <div className="row muted">Пока не нашёл. Подписки и связь появятся сами через пару месяцев трат — или добавь вручную.</div>
      )}
      {data.items.map((p) => (
        <div className="row" key={p.id} style={{ flexWrap: "wrap" }}>
          <span className="grow">
            <span className="row-title ellipsis" style={{ display: "block", minHeight: 0 }}>{p.title}</span>
            <span className="row-sub">
              {p.status === "suggested" ? `похоже на регулярный · каждое ${p.day}-е` : regularWhen(p.day, p.next_on)}
            </span>
          </span>
          <span className="rank-val">{fmtAmount(p.amount, cur)}</span>
          {p.status === "suggested" ? (
            <div className="chips" style={{ width: "100%", marginTop: 8 }}>
              <button type="button" className="pill on" disabled={busy !== null}
                onClick={() => void act(p.id, () => api.confirmRegular(p.id))}>Напоминать</button>
              <button type="button" className="pill" disabled={busy !== null}
                onClick={() => void act(p.id, () => api.dismissRegular(p.id))}>Не регулярный</button>
            </div>
          ) : (
            <button type="button" className="btn quiet" style={{ minHeight: 32, padding: 0, width: "100%", justifyContent: "flex-start" }}
              disabled={busy !== null} onClick={() => void act(p.id, () => api.dismissRegular(p.id))}>
              Не напоминать
            </button>
          )}
        </div>
      ))}
      {data.monthly_total > 0 && (
        <div className="card-foot" style={{ padding: "8px 16px 0" }}>
          В месяц на регулярные: {fmtAmount(data.monthly_total, cur)}. Накануне списания напомню в чате.
        </div>
      )}
      {error && <div className="sub danger" style={{ padding: "0 16px" }}>{error}</div>}
      {adding && (
        <RegularSheet api={api} currency={cur} onClose={() => setAdding(false)}
          onSaved={() => { setAdding(false); reload(); onChanged(); }} />
      )}
    </Card>
  );
}
