import { useState } from "react";
import type { Api } from "../api";
import { useLoad } from "../load";
import { saveError } from "../saveError";
import { planPrice, subStatus } from "../subscription";
import { hapticResult, openInvoice, tap } from "../telegram";
import type { SubPlan } from "../types";
import { ErrorCard, Loading } from "./States";
import { Sheet } from "./Sheet";

const PERKS = [
  "Безлимит голосовых и вопросов «спроси свою жизнь»",
  "Итоги недели по воскресеньям",
  "Запись с кнопки действия iPhone",
  "Ранний доступ к новым функциям",
];

/** Тарифы Pro. Оплата — звёзды Telegram; зачисляет её бот, поэтому после «paid» статус обновляется с задержкой. */
export function SubscriptionSheet({ api, onClose, onChanged }: { api: Api; onClose: () => void; onChanged: () => void }) {
  const { data, error, loading, reload } = useLoad(() => api.subscription(), [api]);
  const [busy, setBusy] = useState<SubPlan["id"] | null>(null);
  const [note, setNote] = useState<string | null>(null);

  async function buy(plan: SubPlan) {
    tap();
    setBusy(plan.id);
    setNote(null);
    try {
      const { url } = await api.invoice(plan.id);
      const status = await openInvoice(url);
      if (status === "paid") {
        hapticResult(true);
        setNote("Оплата прошла — Pro включится через пару секунд.");
        setTimeout(() => { reload(); onChanged(); }, 2500);
      } else if (status === "failed") {
        hapticResult(false);
        setNote("Оплата не прошла. Попробуй ещё раз.");
      }
    } catch (e) {
      hapticResult(false);
      setNote(saveError(e));
    } finally {
      setBusy(null);
    }
  }

  const st = data ? subStatus(data) : null;
  return (
    <Sheet title="Планер Pro" busy={busy !== null} onClose={onClose}>
      {loading && !data && <Loading />}
      {!!error && !data && <ErrorCard onRetry={reload} />}
      {data && st && (
        <>
          <div className="field"><span>Сейчас</span></div>
          <div className="row-title">{st.title}</div>
          <div className="card-foot">{st.hint}</div>

          <div className="field" style={{ marginTop: 20 }}><span>Что даёт Pro</span></div>
          <ul className="sub" style={{ margin: "4px 0 0", paddingLeft: 18 }}>
            {PERKS.map((p) => <li key={p}>{p}</li>)}
          </ul>

          {data.status !== "lifetime" && (
            <>
              <div className="field" style={{ marginTop: 20 }}><span>Тарифы</span></div>
              {data.plans.map((p) => (
                <button type="button" key={p.id} className={p.id === "month" ? "btn wide block" : "btn ghost wide"}
                  style={{ marginTop: 8 }} disabled={busy !== null} onClick={() => void buy(p)}>
                  {busy === p.id ? "Открываю оплату…" : `${p.title} — ${planPrice(p)}`}
                </button>
              ))}
              <div className="card-foot">
                Оплата звёздами Telegram. Месяц продлевается сам — отменить можно в любой момент в настройках Telegram.
              </div>
            </>
          )}
          {note && <div className="sub">{note}</div>}
        </>
      )}
    </Sheet>
  );
}
