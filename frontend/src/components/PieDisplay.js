import React from 'react';

const CATEGORIES = [
  'Geography',
  'Entertainment & Music',
  'History',
  'Science & Nature',
  'Sports & Video Games',
  'Current Events & Trends',
];

const CAT_COLORS = {
  'Geography':              '#3b82f6',
  'Entertainment & Music':  '#ef4444',
  'History':                '#b45309',
  'Science & Nature':       '#d97706',
  'Sports & Video Games':   '#7c3aed',
  'Current Events & Trends':'#0891b2',
};

const CAT_EMOJI = {
  'Geography':              '🌍',
  'Entertainment & Music':  '🎬',
  'History':                '📜',
  'Science & Nature':       '🔬',
  'Sports & Video Games':   '🎮',
  'Current Events & Trends':'📰',
};

export { CATEGORIES, CAT_COLORS, CAT_EMOJI };

export default function PieDisplay({ wedges = [], size = 110 }) {
  const cx = size / 2, cy = size / 2, r = size / 2 - 5;
  const n = CATEGORIES.length;

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <circle cx={cx} cy={cy} r={r + 4} fill="#111" />
      {CATEGORIES.map((cat, i) => {
        const startAngle = (i / n) * 2 * Math.PI - Math.PI / 2;
        const endAngle   = ((i + 1) / n) * 2 * Math.PI - Math.PI / 2;
        const x1 = cx + r * Math.cos(startAngle);
        const y1 = cy + r * Math.sin(startAngle);
        const x2 = cx + r * Math.cos(endAngle);
        const y2 = cy + r * Math.sin(endAngle);
        const mid = (startAngle + endAngle) / 2;
        const filled = wedges.includes(cat);
        return (
          <g key={cat}>
            <path
              d={`M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 0 1 ${x2} ${y2} Z`}
              fill={filled ? CAT_COLORS[cat] : '#1c1c1c'}
              stroke="#0a0a0a"
              strokeWidth="2"
            />
            <text
              x={cx + r * 0.62 * Math.cos(mid)}
              y={cy + r * 0.62 * Math.sin(mid)}
              textAnchor="middle"
              dominantBaseline="middle"
              fontSize={filled ? '11' : '9'}
              opacity={filled ? 1 : 0.2}
            >
              {CAT_EMOJI[cat]}
            </text>
          </g>
        );
      })}
      <circle cx={cx} cy={cy} r={r * 0.18} fill="#0a0a0a" />
    </svg>
  );
}
