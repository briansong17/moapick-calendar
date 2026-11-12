import { validateReview } from './extraction.mjs';
const escape = s => String(s ?? '').replace(/\\/g, '\\\\').replace(/\r?\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;').replace(/\r/g, '');
const date = s => s.replaceAll('-', '');
const utc = (day, time, zone) => new Date(`${day}T${time}:00${zone === 'Asia/Seoul' ? '+09:00' : 'Z'}`).toISOString().replace(/[-:]/g, '').replace('.000', '');
const fold = line => {
  let out = '', bytes = 0;
  for (const c of line) {
    const n = Buffer.byteLength(c);
    if (bytes + n > 73) { out += '\r\n '; bytes = 1; }
    out += c; bytes += n;
  }
  return out;
};
export function calendar(record) {
  const events = validateReview(record.reviewed);
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Instagram Calendar//KO', 'CALSCALE:GREGORIAN'];
  events.forEach((e, index) => {
    lines.push('BEGIN:VEVENT', `UID:${record.id}-${index}@instagram-calendar.local`, `DTSTAMP:${new Date(record.created_at).toISOString().replace(/[-:]/g, '').replace('.000', '')}`, `SUMMARY:${escape(e.title)}`);
    if (e.start_time) {
      lines.push(`DTSTART:${utc(e.start_date, e.start_time, e.timezone)}`);
      if (e.end_time) lines.push(`DTEND:${utc(e.end_date ?? e.start_date, e.end_time, e.timezone)}`);
    } else {
      const end = new Date(e.end_date ?? e.start_date); end.setUTCDate(end.getUTCDate() + 1);
      lines.push(`DTSTART;VALUE=DATE:${date(e.start_date)}`, `DTEND;VALUE=DATE:${date(end.toISOString().slice(0, 10))}`);
    }
    lines.push(`LOCATION:${escape(e.location)}`, `DESCRIPTION:${escape([e.description, e.booking_url, record.metadata.source_url].filter(Boolean).join('\n'))}`, 'END:VEVENT');
  });
  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}
