import type { Api } from "../api";
import { useLoad } from "../load";
import { ProTeaser } from "./ProTeaser";

const WD = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];

/** Статистика привычки (Pro): лучшая серия, выполнение за месяц, в какие дни недели получается. */
export function HabitStatsBlock({ api, id, onPro }: { api: Api; id: string; onPro: () => void }) {
  const { data } = useLoad(() => api.habitStats(id).catch(() => null), [api, id]);
  if (!data) return null;
  if ("locked" in data) {
    return (
      <div style={{ marginTop: 20 }}>
        <ProTeaser title="Статистика и заморозка серии" hint="Лучшая серия, процент за месяц, сильные и слабые дни" onPro={onPro} />
      </div>
    );
  }
  const max = Math.max(...data.by_weekday, 1);
  return (
    <>
      <div className="field" style={{ marginTop: 20 }}><span>Статистика</span></div>
      <div className="stat-grid">
        <div><b className="num">{data.best_streak}</b><span>лучшая серия</span></div>
        <div><b className="num">{data.rate_30}%</b><span>цели за 30 дней</span></div>
        <div><b className="num">{data.done_90}</b><span>раз за 90 дней</span></div>
      </div>
      <div className="wd-bars" role="img"
        aria-label={`По дням недели за 12 недель: ${WD.map((w, i) => `${w} ${data.by_weekday[i]}`).join(", ")}`}>
        {data.by_weekday.map((n, i) => (
          <div key={WD[i]} className="wd-bar">
            <span className="num">{n}</span>
            <i style={{ height: `${Math.round((n / max) * 48)}px` }} />
            <span>{WD[i]}</span>
          </div>
        ))}
      </div>
      <div className="card-foot">
        По дням недели — за последние 12 недель. Заморозок в этом месяце осталось: {data.freezes_left} из 2.
      </div>
    </>
  );
}
