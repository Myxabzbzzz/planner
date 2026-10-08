import { Heat, MoneyMonths, TaskWeeks } from "../components/Charts";
import { IconFlame, IconGear, IconHome, IconLock, IconMedal, IconStar } from "../components/Icons";
import { Meter, Ring } from "../components/Meter";
import { Card, ErrorCard, Loading } from "../components/States";
import type { Api } from "../api";
import { autoRate, badgesOf, finishRate, levelOf, type Badge } from "../gamify";
import { days as daysWord, fmtAmount, fmtDayTitle } from "../format";
import { useLoad } from "../load";
import { subStatus } from "../subscription";
import { offerHomeScreen } from "../homeScreen";
import { useHomeScreen } from "../telegram";

const pct = (x: number) => `${Math.round(x * 100)}%`;

function BadgeCard({ b }: { b: Badge }) {
  return (
    <div className={b.got ? "badge got" : "badge"}>
      <span className="badge-ico">{b.got ? <IconMedal /> : <IconLock />}</span>
      <b>{b.label}</b>
      <span>{b.got ? b.hint : `${b.have} из ${b.need}`}</span>
    </div>
  );
}

/**
 * Профиль: где ты сейчас и как шло до сих пор.
 *
 * Сервер отдаёт только факты (`api_profile`), уровень и награды считает `gamify.ts` —
 * поэтому все цифры здесь настоящие, ничего не выдумано. И никакого давления:
 * серия не обрывается до конца дня, пропуск нигде не осуждается, награды
 * показывают сделанное, а не отнятое.
 */
export function Profile({ api, refresh = 0, onSettings, onAccount, onPro }: {
  api: Api; refresh?: number; onSettings: () => void; onAccount: () => void; onPro: () => void;
}) {
  const { data, error, loading, reload } = useLoad(() => api.profile(6), [api], refresh);
  const sub = useLoad(() => api.subscription(), [api], refresh);
  const home = useHomeScreen();
  if (loading && !data) return <Loading hero />;
  if (error || !data) return <ErrorCard onRetry={reload} />;

  const p = data;
  const level = levelOf(p);
  const badges = badgesOf(p);
  const got = badges.filter((b) => b.got).length;
  const finish = finishRate(p);
  const auto = autoRate(p);
  const week = p.habits.week_target > 0 ? p.habits.week_done / p.habits.week_target : null;

  return (
    <>
      <Card>
        <div className="level">
          <Ring value={level.progress} size={76} width={7} label={`Уровень ${level.index}: ${level.title}`}>
            <span className="num" style={{ font: "600 22px/1 var(--display)" }}>{level.index}</span>
          </Ring>
          <div className="grow">
            <div className="hero-label">Уровень {level.index}</div>
            <div className="level-name">{level.title}</div>
            <div className="sub num">
              {level.next === null
                ? `${level.xp} опыта — выше некуда`
                : `${level.xp} / ${level.next} опыта`}
            </div>
          </div>
        </div>
      </Card>

      <div className="stats">
        <div className="stat">
          <b className="num">{p.active_streak}</b>
          <span>{p.active_streak === 0 ? "дней подряд" : `${daysWord(p.active_streak)} подряд`}</span>
        </div>
        <div className="stat">
          <b className="num">{p.active_days}</b>
          <span>активных дней всего</span>
        </div>
        <div className="stat">
          <b className="num">{p.tasks.done_total}</b>
          <span>закрытых задач</span>
        </div>
        <div className="stat">
          <b className="num">{p.habits.best_streak}</b>
          <span>лучшая полоса привычки</span>
        </div>
      </div>

      {p.active_streak >= 3 && (
        <Card>
          <div className="row" style={{ padding: 0, borderTop: 0 }}>
            <span style={{ color: "var(--accent-text)" }}><IconFlame /></span>
            <span className="grow">
              {daysWord(p.active_streak)} подряд с записями
              <span className="row-sub">Серия не обрывается до конца дня — успеешь ещё</span>
            </span>
          </div>
        </Card>
      )}

      {week !== null && (
        <Card>
          <h3>Привычки на этой неделе</h3>
          <div className="row" style={{ padding: 0, borderTop: 0, minHeight: 0 }}>
            <span className="grow hint" style={{ fontSize: 13 }}>
              {p.habits.active} {p.habits.active === 1 ? "привычка" : "привычки"} · цель {p.habits.week_target} отметок
            </span>
            <span className="meta num">{p.habits.week_done} / {p.habits.week_target}</span>
          </div>
          <Meter value={week} label="Отметки за неделю" />
        </Card>
      )}

      <Card>
        <h3>Активность за 12 недель</h3>
        <Heat days={p.heat} total={p.heat_total} />
        <div className="card-foot">
          Колонка — неделя, строка — день недели. Чем насыщеннее цвет, тем больше привычек отмечено за день.
        </div>
      </Card>

      <Card>
        <h3>Задачи по неделям</h3>
        <TaskWeeks weeks={p.weeks} />
        <div className="card-foot">
          {finish === null
            ? "За месяц новых задач не появлялось."
            : `За 30 дней закрыто ${p.tasks.done_30d} из ${p.tasks.created_30d} появившихся — ${pct(finish)}.`}
          {p.tasks.overdue > 0 && <> Просрочено сейчас: {p.tasks.overdue}.</>}
        </div>
      </Card>

      <Card>
        <h3>Деньги за полгода</h3>
        <MoneyMonths months={p.money.months} currency={p.base_currency} />
        {p.money.limit !== null && (
          <div className="card-foot">Лимит на месяц: {fmtAmount(p.money.limit, p.base_currency)}.</div>
        )}
      </Card>

      <Card>
        <h3>Награды · {got} из {badges.length}</h3>
        <div className="badges">
          {badges.map((b) => <BadgeCard key={b.key} b={b} />)}
        </div>
      </Card>

      <Card>
        <h3>Записи и разбор</h3>
        <div className="row" style={{ borderTop: 0 }}>
          <span className="grow">Всего записей боту</span>
          <span className="meta num">{p.captures.total}</span>
        </div>
        {auto !== null && (
          <div className="row">
            <span className="grow">
              Разобрано без уточнений
              <span className="row-sub">насколько ИИ справляется сам</span>
            </span>
            <span className="meta num">{pct(auto)}</span>
          </div>
        )}
        {p.captures.needs_review > 0 && (
          <div className="row">
            <span className="grow">
              Ждут уточнения
              <span className="row-sub">ответить можно в чате бота</span>
            </span>
            <span className="meta danger num">{p.captures.needs_review}</span>
          </div>
        )}
        <div className="row">
          <span className="grow">Заметок и записей в дневник</span>
          <span className="meta num">{p.notes.thoughts} · {p.notes.journals}</span>
        </div>
        <div className="card-foot">С {fmtDayTitle(p.since)} · {daysWord(p.days_known)} в планере.</div>
      </Card>

      <Card className="flush">
        <button type="button" className="row" style={{ width: "100%", padding: "8px 16px" }} onClick={onPro}>
          <span style={{ color: "var(--accent)" }}><IconStar /></span>
          <span className="grow row-title" style={{ minHeight: 0 }}>Подписка</span>
          <span className="meta">{sub.data ? subStatus(sub.data).title : "Pro"}</span>
        </button>
        {offerHomeScreen(home.status) && (
          <button type="button" className="row" style={{ width: "100%", padding: "8px 16px" }} onClick={home.add}>
            <span style={{ color: "var(--fg-3)" }}><IconHome /></span>
            <span className="grow row-title" style={{ minHeight: 0 }}>На экран «Домой»</span>
            <span className="meta">иконка планера</span>
          </button>
        )}
        <button type="button" className="row" style={{ width: "100%", padding: "8px 16px" }} onClick={onSettings}>
          <span style={{ color: "var(--fg-3)" }}><IconGear /></span>
          <span className="grow row-title" style={{ minHeight: 0 }}>Настройки</span>
          <span className="meta">лимит, уведомления</span>
        </button>
        <button type="button" className="row" style={{ width: "100%", padding: "8px 16px" }} onClick={onAccount}>
          <span style={{ color: "var(--fg-3)" }}><IconLock /></span>
          <span className="grow row-title" style={{ minHeight: 0 }}>Аккаунт</span>
          <span className="meta">валюта, выгрузка</span>
        </button>
      </Card>
    </>
  );
}
