interface ChevronIconProps {
  className?: string;
  direction?: 'down' | 'up' | 'left' | 'right';
}

const ROTATION_BY_DIRECTION: Record<NonNullable<ChevronIconProps['direction']>, number> = {
  down: 0,
  right: -90,
  up: 180,
  left: 90,
};

export default function ChevronIcon({
  className,
  direction = 'down',
}: ChevronIconProps) {
  const rotation = ROTATION_BY_DIRECTION[direction];

  return (
    <svg
      className={className}
      viewBox="0 0 20 20"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      <g transform={`rotate(${rotation} 10 10)`}>
        <path
          d="M5.6 8.2L10 12.6L14.4 8.2"
          stroke="currentColor"
          strokeWidth="1.9"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </g>
    </svg>
  );
}
