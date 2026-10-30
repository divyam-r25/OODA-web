const P: Record<string, string> = {
  briefing: 'M4 5h16M4 10h16M4 15h10M4 20h7',
  signals: 'M3 12h4l3-8 4 16 3-8h4',
  research: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-4.2-4.2',
  competitors: 'M3 20V9l6-3v14M9 20V11l6-3v12M15 20h6v-7M3 20h18',
  compare: 'M4 4h6v16H4zM14 4h6v16h-6z',
  reports: 'M7 3h7l5 5v13H7zM14 3v5h5M10 13h6M10 17h6',
  actions: 'M4 4h16v16H4zM8 12l3 3 5-6',
  settings: 'M4 7h9M17 7h3M4 17h3M11 17h9M15 5v4M9 15v4',
  plus: 'M12 5v14M5 12h14',
  x: 'M6 6l12 12M18 6L6 18',
  chevron: 'M9 6l6 6-6 6',
  external: 'M14 4h6v6M20 4l-9 9M18 14v6H4V6h6',
  download: 'M12 4v11M7 11l5 5 5-5M5 20h14',
  trash: 'M5 7h14M9 7V4h6v3M7 7l1 13h8l1-13',
  edit: 'M4 20l4-1 11-11-3-3L5 16z',
  refresh: 'M20 11a8 8 0 0 0-14-4M4 4v4h4M4 13a8 8 0 0 0 14 4M20 20v-4h-4',
  alert: 'M12 4l9 16H3zM12 10v4M12 17v.5',
  info: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 11v5M12 8v.5',
  check: 'M5 12l5 5 9-10',
  menu: 'M4 7h16M4 12h16M4 17h16',
  logout: 'M10 4H4v16h6M14 8l4 4-4 4M18 12H9',
  search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-4.2-4.2',
  print: 'M7 9V3h10v6M7 17H4v-7h16v7h-3M7 14h10v7H7z',
  stop: 'M6 6h12v12H6z',
  link: 'M10 14a4 4 0 0 0 6 0l3-3a4 4 0 0 0-6-6l-1 1M14 10a4 4 0 0 0-6 0l-3 3a4 4 0 0 0 6 6l1-1',
};
export function Icon({ name, size = 18, className }: { name: keyof typeof P | string; size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={className} focusable="false">
      <path d={P[name] ?? ''} />
    </svg>
  );
}

/** The OODA mark: a four-segment loop with a centre point. */
export function Mark({ size = 30 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <path d="M16 6a10 10 0 0 1 9.5 7" fill="none" stroke="#b2cf82" strokeWidth="2.8" strokeLinecap="round" />
      <path d="M25.5 19A10 10 0 0 1 16 26" fill="none" stroke="#e7eedc" strokeWidth="2.8" strokeLinecap="round" />
      <path d="M16 26a10 10 0 0 1-9.5-7" fill="none" stroke="#b2cf82" strokeWidth="2.8" strokeLinecap="round" />
      <path d="M6.5 13A10 10 0 0 1 16 6" fill="none" stroke="#e7eedc" strokeWidth="2.8" strokeLinecap="round" />
      <circle cx="16" cy="16" r="2.6" fill="#b2cf82" />
    </svg>
  );
}
