import type { ReactNode } from "react";
import { Mark } from "./Brand";
import { IconCalm } from "./Icons";

export const Card = ({ children, className = "" }: { children: ReactNode; className?: string }) => (
  <section className={className ? `card ${className}` : "card"}>{children}</section>
);

export const Loading = ({ hero = false }: { hero?: boolean }) => (
  <div className="skeletons" role="status" aria-label="Загрузка">
    {hero && <div className="sk big" />}
    <div className="sk" />
    <div className="sk" />
  </div>
);

export const ErrorCard = ({ onRetry, text = "Не удалось загрузить" }: { onRetry: () => void; text?: string }) => (
  <Card className="center">
    <p>{text}</p>
    <button type="button" className="btn ghost block" onClick={onRetry}>Повторить</button>
  </Card>
);

/**
 * Пустое состояние всегда предлагает действие прямо здесь.
 * Раньше оно отправляло в чат бота («скажи боту “кофе 40 000”»),
 * хотя композер и кнопка «добавить» уже на экране.
 */
export const Empty = ({ title, hint, action }: {
  title: string; hint?: string; action?: { label: string; onClick: () => void };
}) => (
  <Card className="center empty">
    <div className="empty-ico"><IconCalm /></div>
    <p>{title}</p>
    {hint && <p className="hint">{hint}</p>}
    {action && <button type="button" className="btn" onClick={action.onClick}>{action.label}</button>}
  </Card>
);

export const FullScreenMessage = ({ title, hint, action }: {
  title: string; hint?: string; action?: { label: string; onClick: () => void };
}) => (
  <div className="fullscreen">
    <Mark size={56} />
    <h2>{title}</h2>
    {hint && <p className="hint">{hint}</p>}
    {action && <button type="button" className="btn" onClick={action.onClick}>{action.label}</button>}
  </div>
);
