import type { ReactNode } from "react";
import { BearMark } from "./Brand";

export const Card = ({ children, className = "" }: { children: ReactNode; className?: string }) =>
  <section className={`card ${className}`}>{children}</section>;

export const Loading = () => (
  <div className="skeletons">
    <div className="skeleton big" />
    <div className="skeleton" />
    <div className="skeleton" />
  </div>
);

export const ErrorCard = ({ onRetry }: { onRetry: () => void }) => (
  <Card className="center">
    <p>Не удалось загрузить</p>
    <button className="button" onClick={onRetry}>Повторить</button>
  </Card>
);

export const Empty = ({ title, hint }: { title: string; hint?: string }) => (
  <Card className="center muted">
    <p>{title}</p>
    {hint && <p className="hint">{hint}</p>}
  </Card>
);

export const FullScreenMessage = ({ title, hint, action }: { title: string; hint?: string; action?: { label: string; onClick: () => void } }) => (
  <div className="fullscreen">
    <BearMark size={64} />
    <h2>{title}</h2>
    {hint && <p className="hint">{hint}</p>}
    {action && <button className="button" onClick={action.onClick}>{action.label}</button>}
  </div>
);
