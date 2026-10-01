/**
 * EVERY `Intl` THE APP NEEDS, BEHIND ONE DOOR, WITH A FALLBACK BEHIND EACH.
 *
 * Phase 38I. The native build runs on Hermes, and whether Hermes on iOS ships
 * the `Intl` these paths lean on — `DateTimeFormat` with a named `timeZone`,
 * `formatToParts`, `NumberFormat` — was the first unknown in
 * docs/native-preflight.md. Until this file, the day-boundary timer
 * (writeDay.ts), the date label on check-in (dayLabel.ts) and every clock
 * and number label called `Intl` or `toLocale*` directly, and an engine
 * without it would have thrown in the two that matter and printed raw
 * strings in the rest.
 *
 * Now each capability is asked for through here, and each has a pure
 * fallback that is worse but never wrong in kind:
 *
 *   wallClockIn      the zone's wall clock            -> the device's wall clock
 *   zoneIsUsable     "does this runtime know the zone" -> false, so callers use
 *                                                        the device zone
 *   formatClock      "7:45 PM"                        -> the same, by hand
 *   formatCalendar   "Wednesday 10 September"         -> the same, in English
 *   formatInteger    "12,480"                         -> the same, by hand
 *
 * `intl` is injectable so scripts/intl.test.mjs can hand in `undefined`, or
 * an Intl that throws on named zones, and prove the fallback path in Node.
 * The dev-only diagnostics screen calls probeIntl() on a real device.
 *
 * Kept free of react-native imports so it runs in plain Node.
 */

/**
 * The parts of the global `Intl` this app touches. Injectable: `undefined`
 * means the real global, `null` means "there is no Intl at all" — which is
 * how scripts/intl.test.mjs drives the fallback path.
 */
export interface IntlLike {
  DateTimeFormat?: typeof Intl.DateTimeFormat;
  NumberFormat?: typeof Intl.NumberFormat;
}

const realIntl = (): IntlLike | undefined =>
  (globalThis as { Intl?: IntlLike }).Intl;

/** `undefined` -> the real Intl; `null` -> none; anything else -> as given. */
const resolve = (intl: IntlLike | null | undefined): IntlLike | undefined =>
  intl === undefined ? realIntl() : intl ?? undefined;

export interface IntlCapabilities {
  /** `new Intl.DateTimeFormat()` constructs and formats. */
  dateTimeFormat: boolean;
  /** `.formatToParts()` exists and returns parts. */
  formatToParts: boolean;
  /** A named IANA zone is accepted and changes the answer. */
  namedTimeZone: boolean;
  /** `Intl.NumberFormat` groups thousands. */
  numberFormat: boolean;
  /** What formatting `zoneTried` produced, or the error, for the diagnostics. */
  sample: string;
  zoneTried: string;
}

/**
 * What this runtime can do. Cheap, side-effect free, safe to call at launch.
 * `zone` defaults to a zone whose offset differs from UTC for most of the
 * year, so "accepted but ignored" is detectable: the hour must differ from
 * UTC's at least at one of the two probes.
 */
export function probeIntl(
  intlIn?: IntlLike | null,
  zone = 'America/New_York',
): IntlCapabilities {
  const intl = resolve(intlIn);
  const out: IntlCapabilities = {
    dateTimeFormat: false,
    formatToParts: false,
    namedTimeZone: false,
    numberFormat: false,
    sample: '',
    zoneTried: zone,
  };
  const DTF = intl?.DateTimeFormat;
  if (DTF) {
    try {
      const f = new DTF('en-US', { hour: 'numeric', minute: '2-digit' });
      out.dateTimeFormat = typeof f.format(new Date()) === 'string';
    } catch {
      out.dateTimeFormat = false;
    }
    try {
      const f = new DTF('en-US', { timeZone: zone, hour: 'numeric', hour12: false });
      const parts = typeof f.formatToParts === 'function' ? f.formatToParts(new Date()) : null;
      out.formatToParts = Array.isArray(parts) && parts.some((p) => p.type === 'hour');
      // Two instants six months apart: at least one of them is not UTC.
      const utcHour = (d: Date) => d.getUTCHours();
      const zoneHour = (d: Date) => Number(f.formatToParts(d).find((p) => p.type === 'hour')?.value) % 24;
      const a = new Date();
      const b = new Date(a.getTime() + 182 * 86_400_000);
      out.namedTimeZone =
        out.formatToParts && (zoneHour(a) !== utcHour(a) || zoneHour(b) !== utcHour(b));
      out.sample = new DTF('en-US', {
        timeZone: zone,
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      }).format(a);
    } catch (e) {
      out.sample = `error: ${e instanceof Error ? e.message : String(e)}`;
    }
  } else {
    out.sample = 'Intl.DateTimeFormat is absent';
  }
  const NF = intl?.NumberFormat;
  if (NF) {
    try {
      out.numberFormat = new NF('en-US').format(1234567) === '1,234,567';
    } catch {
      out.numberFormat = false;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// The wall clock in a zone. What writeDay.ts and dayLabel.ts are built on.
// ---------------------------------------------------------------------------

export interface WallClockParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

/** True when this runtime accepts `zone` by name and honours it. */
export function zoneIsUsable(
  zone: string | null | undefined,
  intlIn?: IntlLike | null,
): boolean {
  const intl = resolve(intlIn);
  if (!zone) return false;
  const DTF = intl?.DateTimeFormat;
  if (!DTF) return false;
  try {
    const f = new DTF('en-US', { timeZone: zone, hour: 'numeric', hour12: false });
    return typeof f.formatToParts === 'function' && f.formatToParts(new Date()).length > 0;
  } catch {
    return false;
  }
}

/**
 * What `zone`'s wall clock reads at instant `at`. `zone` undefined means the
 * device's zone. FALLBACK: without a usable Intl the DEVICE's wall clock is
 * returned whatever zone was asked for — degraded, and honest about it only
 * through probeIntl(); the callers already treat "zone unknown" as "use the
 * device's", so this is the same degradation they were built for.
 */
export function wallClockIn(
  at: number,
  zone: string | undefined,
  intlIn?: IntlLike | null,
): WallClockParts {
  const intl = resolve(intlIn);
  const DTF = intl?.DateTimeFormat;
  if (DTF) {
    try {
      const parts = new DTF('en-US', {
        timeZone: zone,
        hour12: false,
        year: 'numeric',
        month: 'numeric',
        day: 'numeric',
        hour: 'numeric',
        minute: 'numeric',
        second: 'numeric',
      }).formatToParts(new Date(at));
      const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
      const w = {
        year: get('year'),
        month: get('month'),
        day: get('day'),
        // Some engines render midnight as "24" under hour12: false.
        hour: get('hour') % 24,
        minute: get('minute'),
        second: get('second'),
      };
      if (Object.values(w).every(Number.isFinite)) return w;
    } catch {
      /* fall through to the device clock */
    }
  }
  const d = new Date(at);
  return {
    year: d.getFullYear(),
    month: d.getMonth() + 1,
    day: d.getDate(),
    hour: d.getHours(),
    minute: d.getMinutes(),
    second: d.getSeconds(),
  };
}

// ---------------------------------------------------------------------------
// Labels. Each tries Intl and falls back to the same shape by hand.
// ---------------------------------------------------------------------------

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
  'August', 'September', 'October', 'November', 'December'];
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** "7:45 PM" for an instant, in the device's zone. */
export function formatClock(
  at: number | Date,
  intlIn?: IntlLike | null,
): string {
  const intl = resolve(intlIn);
  const d = typeof at === 'number' ? new Date(at) : at;
  const DTF = intl?.DateTimeFormat;
  if (DTF) {
    try {
      return new DTF(undefined, { hour: 'numeric', minute: '2-digit' }).format(d);
    } catch {
      /* fall through */
    }
  }
  const h = d.getHours();
  const h12 = h % 12 || 12;
  return `${h12}:${String(d.getMinutes()).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}

export interface CalendarOptions {
  weekday?: 'long' | 'short';
  month: 'long' | 'short' | 'numeric';
  day: 'numeric';
  year?: 'numeric';
  /** 'UTC' reads the instant as a UTC date (dayLabel's trick); default device. */
  timeZone?: 'UTC';
}

/** "Wednesday 10 September", "Sep 10", "Sep 10, 2026" — the calendar labels. */
export function formatCalendar(
  d: Date,
  options: CalendarOptions,
  intlIn?: IntlLike | null,
): string {
  const intl = resolve(intlIn);
  const DTF = intl?.DateTimeFormat;
  if (DTF) {
    try {
      return new DTF(undefined, options).format(d);
    } catch {
      /* fall through */
    }
  }
  const utc = options.timeZone === 'UTC';
  const y = utc ? d.getUTCFullYear() : d.getFullYear();
  const m = utc ? d.getUTCMonth() : d.getMonth();
  const day = utc ? d.getUTCDate() : d.getDate();
  const wd = utc ? d.getUTCDay() : d.getDay();
  const month =
    options.month === 'numeric' ? String(m + 1)
      : options.month === 'short' ? MONTHS[m].slice(0, 3)
        : MONTHS[m];
  const weekday =
    options.weekday === 'long' ? `${WEEKDAYS[wd]} `
      : options.weekday === 'short' ? `${WEEKDAYS[wd].slice(0, 3)} `
        : '';
  const year = options.year ? ` ${y}` : '';
  return options.month === 'numeric'
    ? `${weekday}${month}/${day}${year ? `/${y}` : ''}`
    : `${weekday}${day} ${month}${year}`;
}

/** "12,480" — an integer with thousands grouped. */
export function formatInteger(
  n: number,
  intlIn?: IntlLike | null,
): string {
  const intl = resolve(intlIn);
  const NF = intl?.NumberFormat;
  if (NF) {
    try {
      return new NF(undefined, { maximumFractionDigits: 0 }).format(n);
    } catch {
      /* fall through */
    }
  }
  const sign = n < 0 ? '-' : '';
  const digits = String(Math.round(Math.abs(n)));
  return sign + digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}
