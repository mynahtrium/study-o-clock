const timeFmt = new Intl.DateTimeFormat('tr-TR', {
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

const timeWithSecondsFmt = new Intl.DateTimeFormat('tr-TR', {
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
});

const weekdayFmt = new Intl.DateTimeFormat('tr-TR', { weekday: 'long' });

const dateFmt = new Intl.DateTimeFormat('tr-TR', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
});

const time12Fmt = new Intl.DateTimeFormat('tr-TR', {
  hour: 'numeric',
  minute: '2-digit',
  hour12: true,
});

function partsToMap(date: Date, fmt: Intl.DateTimeFormat): Record<string, string> {
  const out: Record<string, string> = {};
  for (const p of fmt.formatToParts(date)) {
    if (p.type !== 'literal') out[p.type] = p.value;
  }
  return out;
}

export interface TimeParts {
  /** Zero-padded hour, 24h. */
  hour: string;
  /** Zero-padded minute. */
  minute: string;
  /** Zero-padded second. */
  second: string;
}

export function timeParts(date: Date, use24h = true): TimeParts {
  const m = partsToMap(date, use24h ? timeWithSecondsFmt : time12Fmt);
  return {
    hour: m.hour ?? '00',
    minute: m.minute ?? '00',
    second: m.second ?? '00',
  };
}

/** Full HH:MM for the document title and cheap consumers. */
export function formatTime(date: Date, use24h = true): string {
  return (use24h ? timeFmt : time12Fmt).format(date);
}

export function formatWithSeconds(date: Date): string {
  return timeWithSecondsFmt.format(date);
}

export function formatWeekday(date: Date): string {
  return weekdayFmt.format(date);
}

export function formatDate(date: Date): string {
  return dateFmt.format(date);
}

export function formatTimezone(): string {
  try {
    return new Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return '—';
  }
}
