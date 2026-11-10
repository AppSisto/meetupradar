// Generátor iCalendar (.ics). Sdílený mezi prohlížečem (export výběru) a sync skriptem (feedy).

const pad = (n) => String(n).padStart(2, '0');
const esc = (s) => String(s ?? '').replace(/\\/g, '\\\\').replace(/\r?\n/g, '\\n').replace(/([,;])/g, '\\$1');
const utc = (d) =>
  `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}00Z`;
const dateOnly = (s) => s.slice(0, 10).replace(/-/g, '');
const nextDay = (s) => {
  const d = new Date(s.slice(0, 10) + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10).replace(/-/g, '');
};

// Řádky delší než 75 oktetů se podle RFC 5545 zalamují.
const fold = (line) => {
  const out = [];
  let cur = '';
  let bytes = 0;
  for (const ch of line) {
    const b = new TextEncoder().encode(ch).length;
    if (bytes + b > 73) {
      out.push(cur);
      cur = ' ';
      bytes = 1;
    }
    cur += ch;
    bytes += b;
  }
  out.push(cur);
  return out.join('\r\n');
};

export function toICS(events, name = 'Meetup Radar') {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Meetup Radar//CS',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${esc(name)}`,
    'X-WR-TIMEZONE:Europe/Prague',
    'REFRESH-INTERVAL;VALUE=DURATION:PT6H',
    'X-PUBLISHED-TTL:PT6H',
  ];
  const stamp = utc(new Date());
  for (const e of events) {
    lines.push('BEGIN:VEVENT', `UID:${e.id}@meetupradar`, `DTSTAMP:${stamp}`);
    if (e.allDay) {
      lines.push(`DTSTART;VALUE=DATE:${dateOnly(e.start)}`, `DTEND;VALUE=DATE:${nextDay(e.end || e.start)}`);
    } else {
      const s = new Date(e.start);
      const en = e.end ? new Date(e.end) : new Date(s.getTime() + 2 * 3600e3);
      lines.push(`DTSTART:${utc(s)}`, `DTEND:${utc(en)}`);
    }
    const where = e.online ? 'Online' : [e.venue, e.address || e.city].filter(Boolean).join(', ');
    lines.push(`SUMMARY:${esc(e.title)}`);
    if (where) lines.push(`LOCATION:${esc(where)}`);
    lines.push(`DESCRIPTION:${esc([e.description, e.url].filter(Boolean).join('\n\n'))}`);
    if (e.url) lines.push(`URL:${e.url}`);
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}
