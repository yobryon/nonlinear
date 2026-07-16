import type { CSSProperties, ReactNode } from 'react';
import type { Priority, StateCategory, ProjectStatus } from '@nonlinear/shared';

interface IconProps {
  size?: number;
  className?: string;
  style?: CSSProperties;
}

function I({
  children,
  size = 16,
  className,
  style,
  viewBox = '0 0 24 24',
  fill = 'none',
  strokeWidth = 1.8,
}: IconProps & {
  children: ReactNode;
  viewBox?: string;
  fill?: string;
  strokeWidth?: number;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox={viewBox}
      fill={fill}
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      style={style}
      aria-hidden
    >
      {children}
    </svg>
  );
}

export const SearchIcon = (p: IconProps) => (
  <I {...p}>
    <circle cx="11" cy="11" r="7" />
    <path d="m21 21-4.35-4.35" />
  </I>
);

export const InboxIcon = (p: IconProps) => (
  <I {...p}>
    <polyline points="22 12 16 12 14 15 10 15 8 12 2 12" />
    <path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
  </I>
);

export const PlusIcon = (p: IconProps) => (
  <I {...p}>
    <path d="M12 5v14M5 12h14" />
  </I>
);

export const ChevronDownIcon = (p: IconProps) => (
  <I {...p}>
    <polyline points="6 9 12 15 18 9" />
  </I>
);

export const ChevronRightIcon = (p: IconProps) => (
  <I {...p}>
    <polyline points="9 6 15 12 9 18" />
  </I>
);

export const CloseIcon = (p: IconProps) => (
  <I {...p}>
    <path d="M18 6 6 18M6 6l12 12" />
  </I>
);

export const CheckIcon = (p: IconProps) => (
  <I {...p}>
    <polyline points="20 6 9 17 4 12" />
  </I>
);

export const DotsIcon = (p: IconProps) => (
  <I {...p} fill="currentColor" strokeWidth={0}>
    <circle cx="5" cy="12" r="1.6" />
    <circle cx="12" cy="12" r="1.6" />
    <circle cx="19" cy="12" r="1.6" />
  </I>
);

export const SettingsIcon = (p: IconProps) => (
  <I {...p}>
    <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
    <circle cx="12" cy="12" r="3" />
  </I>
);

export const StarIcon = (p: IconProps & { filled?: boolean }) => (
  <I {...p} fill={p.filled ? 'currentColor' : 'none'}>
    <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
  </I>
);

export const CalendarIcon = (p: IconProps) => (
  <I {...p}>
    <rect x="3" y="4" width="18" height="18" rx="2" />
    <path d="M16 2v4M8 2v4M3 10h18" />
  </I>
);

export const LabelIcon = (p: IconProps) => (
  <I {...p}>
    <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" />
    <circle cx="7" cy="7" r="1" fill="currentColor" />
  </I>
);

export const CycleIcon = (p: IconProps) => (
  <I {...p}>
    <path d="M23 4v6h-6" />
    <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
  </I>
);

export const ProjectIcon = (p: IconProps) => (
  <I {...p}>
    <path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
    <polyline points="3.29 7 12 12 20.71 7" />
    <path d="M12 22V12" />
  </I>
);

export const UserIcon = (p: IconProps) => (
  <I {...p}>
    <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
    <circle cx="12" cy="7" r="4" />
  </I>
);

export const TeamIcon = (p: IconProps) => (
  <I {...p}>
    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
    <circle cx="9" cy="7" r="4" />
    <path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
  </I>
);

export const BellIcon = (p: IconProps) => (
  <I {...p}>
    <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
    <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
  </I>
);

export const ListIcon = (p: IconProps) => (
  <I {...p}>
    <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />
  </I>
);

export const BoardIcon = (p: IconProps) => (
  <I {...p}>
    <rect x="3" y="3" width="7" height="14" rx="1.5" />
    <rect x="14" y="3" width="7" height="9" rx="1.5" />
  </I>
);

export const CopyIcon = (p: IconProps) => (
  <I {...p}>
    <rect x="9" y="9" width="13" height="13" rx="2" />
    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
  </I>
);

export const LinkIcon = (p: IconProps) => (
  <I {...p}>
    <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
    <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
  </I>
);

export const TrashIcon = (p: IconProps) => (
  <I {...p}>
    <polyline points="3 6 5 6 21 6" />
    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
  </I>
);

export const PencilIcon = (p: IconProps) => (
  <I {...p}>
    <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
  </I>
);

export const ArrowLeftIcon = (p: IconProps) => (
  <I {...p}>
    <path d="M19 12H5" />
    <polyline points="12 19 5 12 12 5" />
  </I>
);

export const SendIcon = (p: IconProps) => (
  <I {...p}>
    <path d="m22 2-7 20-4-9-9-4Z" />
    <path d="M22 2 11 13" />
  </I>
);

export const SunIcon = (p: IconProps) => (
  <I {...p}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2m0 16v2M4.93 4.93l1.41 1.41m11.32 11.32 1.41 1.41M2 12h2m16 0h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
  </I>
);

export const MoonIcon = (p: IconProps) => (
  <I {...p}>
    <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />
  </I>
);

export const LogoutIcon = (p: IconProps) => (
  <I {...p}>
    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
    <polyline points="16 17 21 12 16 7" />
    <path d="M21 12H9" />
  </I>
);

export const FilterIcon = (p: IconProps) => (
  <I {...p}>
    <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
  </I>
);

export const EstimateIcon = (p: IconProps) => (
  <I {...p}>
    <path d="M4 9h16M4 15h16M10 3 8 21M16 3l-2 18" />
  </I>
);

export const ParentIcon = (p: IconProps) => (
  <I {...p}>
    <circle cx="12" cy="12" r="9" />
    <circle cx="12" cy="12" r="3" fill="currentColor" strokeWidth={0} />
  </I>
);

export const SpinnerIcon = (p: IconProps) => (
  <I {...p} className={`spin${p.className ? ` ${p.className}` : ''}`}>
    <path d="M21 12a9 9 0 1 1-6.22-8.56" />
  </I>
);

/* ---- workflow state icons (Linear-style progress circles) ---- */

export function StateIcon({
  category,
  color,
  size = 14,
}: {
  category: StateCategory;
  color: string;
  size?: number;
}) {
  const common = { width: size, height: size, viewBox: '0 0 14 14', 'aria-hidden': true as const };
  switch (category) {
    case 'triage':
      return (
        <svg {...common} fill={color}>
          <circle cx="7" cy="7" r="6" fill="none" stroke={color} strokeWidth="1.6" />
          <path d="M7 3.6v4.2" stroke={color} strokeWidth="1.6" strokeLinecap="round" />
          <circle cx="7" cy="10.2" r="0.9" />
        </svg>
      );
    case 'backlog':
      return (
        <svg {...common} fill="none">
          <circle
            cx="7"
            cy="7"
            r="6"
            stroke={color}
            strokeWidth="1.6"
            strokeDasharray="2.4 2.2"
            strokeLinecap="round"
          />
        </svg>
      );
    case 'unstarted':
      return (
        <svg {...common} fill="none">
          <circle cx="7" cy="7" r="6" stroke={color} strokeWidth="1.6" />
        </svg>
      );
    case 'started':
      return (
        <svg {...common}>
          <circle cx="7" cy="7" r="6" fill="none" stroke={color} strokeWidth="1.6" />
          <path d="M7 7 L7 2.8 A4.2 4.2 0 0 1 11.2 7 Z" fill={color} />
          <path d="M7 7 L11.2 7 A4.2 4.2 0 0 1 7 11.2 Z" fill={color} opacity="0.9" />
        </svg>
      );
    case 'completed':
      return (
        <svg {...common}>
          <circle cx="7" cy="7" r="6.5" fill={color} />
          <path
            d="M4.4 7.2 6.2 9l3.4-3.6"
            stroke="#fff"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
          />
        </svg>
      );
    case 'canceled':
      return (
        <svg {...common}>
          <circle cx="7" cy="7" r="6.5" fill={color} />
          <path
            d="M4.8 4.8l4.4 4.4M9.2 4.8 4.8 9.2"
            stroke="#fff"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </svg>
      );
  }
}

/* ---- priority icons (Linear-style bars) ---- */

export function PriorityIcon({ priority, size = 14 }: { priority: Priority; size?: number }) {
  const common = { width: size, height: size, viewBox: '0 0 14 14', 'aria-hidden': true as const };
  const gray = 'var(--text-3)';
  const faint = 'var(--text-4)';
  if (priority === 1) {
    return (
      <svg {...common}>
        <rect x="0.5" y="0.5" width="13" height="13" rx="3" fill="#fc7840" />
        <path d="M7 3.4v4.5" stroke="#fff" strokeWidth="1.7" strokeLinecap="round" />
        <circle cx="7" cy="10.4" r="1" fill="#fff" />
      </svg>
    );
  }
  if (priority === 0) {
    return (
      <svg {...common} fill={faint}>
        <rect x="1.5" y="6.2" width="2.6" height="1.6" rx="0.8" />
        <rect x="5.7" y="6.2" width="2.6" height="1.6" rx="0.8" />
        <rect x="9.9" y="6.2" width="2.6" height="1.6" rx="0.8" />
      </svg>
    );
  }
  const filled = priority === 2 ? 3 : priority === 3 ? 2 : 1;
  return (
    <svg {...common}>
      <rect x="1.5" y="8" width="3" height="4.5" rx="1" fill={filled >= 1 ? gray : faint} opacity={filled >= 1 ? 1 : 0.5} />
      <rect x="5.5" y="5" width="3" height="7.5" rx="1" fill={filled >= 2 ? gray : faint} opacity={filled >= 2 ? 1 : 0.5} />
      <rect x="9.5" y="2" width="3" height="10.5" rx="1" fill={filled >= 3 ? gray : faint} opacity={filled >= 3 ? 1 : 0.5} />
    </svg>
  );
}

/* ---- project status icon ---- */

export function ProjectStatusIcon({ status, size = 14 }: { status: ProjectStatus; size?: number }) {
  const colors: Record<ProjectStatus, string> = {
    backlog: 'var(--text-4)',
    planned: '#8a8f98',
    started: '#f2c94c',
    paused: '#95a2b3',
    completed: '#5e6ad2',
    canceled: '#95a2b3',
  };
  const color = colors[status];
  const common = { width: size, height: size, viewBox: '0 0 14 14', 'aria-hidden': true as const };
  if (status === 'completed') {
    return (
      <svg {...common}>
        <circle cx="7" cy="7" r="6.5" fill={color} />
        <path d="M4.4 7.2 6.2 9l3.4-3.6" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      </svg>
    );
  }
  if (status === 'canceled') {
    return (
      <svg {...common}>
        <circle cx="7" cy="7" r="6.5" fill={color} />
        <path d="M4.8 4.8l4.4 4.4M9.2 4.8 4.8 9.2" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    );
  }
  if (status === 'started') {
    return (
      <svg {...common}>
        <circle cx="7" cy="7" r="6" fill="none" stroke={color} strokeWidth="1.6" />
        <path d="M7 7 L7 2.8 A4.2 4.2 0 0 1 11.2 7 Z" fill={color} />
      </svg>
    );
  }
  if (status === 'paused') {
    return (
      <svg {...common}>
        <circle cx="7" cy="7" r="6" fill="none" stroke={color} strokeWidth="1.6" />
        <path d="M5.6 4.8v4.4M8.4 4.8v4.4" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    );
  }
  if (status === 'backlog') {
    return (
      <svg {...common} fill="none">
        <circle cx="7" cy="7" r="6" stroke={color} strokeWidth="1.6" strokeDasharray="2.4 2.2" strokeLinecap="round" />
      </svg>
    );
  }
  return (
    <svg {...common} fill="none">
      <circle cx="7" cy="7" r="6" stroke={color} strokeWidth="1.6" />
    </svg>
  );
}
