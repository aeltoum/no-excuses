export function Barbell({
  count,
  target,
  size,
  activityTypes = [],
}: {
  count: number;
  target: number;
  size: "big" | "mini";
  activityTypes?: ("strength" | "cardio" | "class" | "sport" | "mixed")[];
}) {
  const big = size === "big";
  const width = big ? 350 : 170;
  const height = big ? 132 : 30;
  const center = width / 2;
  const slots = Math.max(count, target, 1);
  const capacity = big ? 92 : 56;
  const gap = Math.min(big ? 3 : 2, capacity / (slots * 3));
  const plateWidth = Math.min(
    big ? 20 : 6,
    (capacity - gap * (slots - 1)) / slots,
  );
  const collar = big ? 72 : 26;
  const collarWidth = big ? 6 : 2.5;
  const startGap = big ? 8 : 4;
  const plateHeight = big ? height : height - 4;
  const plateY = big ? 0 : 2;

  return (
    <svg
      className={`barbell barbell-${size}`}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={`${count} of ${target} workouts`}
    >
      <rect
        x="0"
        y={height / 2 - (big ? 3 : 1.5)}
        width={width}
        height={big ? 6 : 3}
        rx={big ? 3 : 1.5}
        fill="var(--bar)"
      />
      <rect
        x={center - (big ? 70 : 24)}
        y={height / 2 - (big ? 5 : 2.5)}
        width={big ? 140 : 48}
        height={big ? 10 : 5}
        rx={big ? 2 : 1.5}
        fill="var(--bar-grip)"
      />
      {([-1, 1] as const).map((side) => {
        const collarX = center + side * collar;
        const platesStart = collarX + side * startGap;
        return (
          <g key={side}>
            <rect
              x={side < 0 ? collarX - collarWidth : collarX}
              y={height / 2 - (big ? 14 : 6)}
              width={collarWidth}
              height={big ? 28 : 12}
              rx={big ? 1.5 : 1}
              fill="var(--bar-collar)"
            />
            {Array.from({ length: slots }, (_, index) => {
              const offset = index * (plateWidth + gap);
              const x =
                side < 0
                  ? platesStart - offset - plateWidth
                  : platesStart + offset;
              const filled = index < count;
              return (
                <rect
                  key={x}
                  x={x}
                  y={plateY}
                  width={plateWidth}
                  height={plateHeight}
                  rx={big ? 3 : 1.5}
                  fill={
                    filled
                      ? activityTypes[index]
                        ? `var(--activity-${activityTypes[index]})`
                        : "var(--chalk)"
                      : "none"
                  }
                  stroke={filled ? undefined : "var(--empty-slot)"}
                  strokeWidth={filled ? undefined : big ? 1.5 : 1.2}
                  strokeDasharray={filled ? undefined : big ? "4 4" : "3 3"}
                />
              );
            })}
          </g>
        );
      })}
    </svg>
  );
}
