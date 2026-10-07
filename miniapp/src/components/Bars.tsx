export function Bars({ bars, today }: { bars: { day: number; value: number; h: number }[]; today?: number }) {
  const mid = Math.ceil(bars.length / 2);
  return (
    <>
      <div className="bars">
        {bars.map((b) => (
          <div key={b.day} className="bar-col" title={`${b.day}: ${b.value}`}>
            <div className={b.day === today ? "bar now" : "bar"} style={{ height: `${Math.max(b.h * 100, b.value > 0 ? 4 : 0)}%` }} />
          </div>
        ))}
      </div>
      {bars.length > 0 && (
        <div className="bar-axis" aria-hidden="true"><span>1</span><span>{mid}</span><span>{bars.length}</span></div>
      )}
    </>
  );
}
