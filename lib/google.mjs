import {AppError,validateReview} from './extraction.mjs';
export const GOOGLE_SCOPE='https://www.googleapis.com/auth/calendar.app.created';
const nextDay = value => { const d = new Date(value); d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10); };
export function googleEvent(event, id, source) {
  validateReview([event]);
  if (event.start_time && !event.end_time) throw new AppError('Google 등록에는 종료 시간이 필요합니다. 원문 확인 후 종료 시간을 입력해 주세요.');
  const stamp = (day, time) => ({ dateTime: `${day}T${time}:00${event.timezone === 'Asia/Seoul' ? '+09:00' : 'Z'}`, timeZone: event.timezone });
  return {
    id, summary: event.title, location: event.location || '',
    description: [event.description, event.booking_url, source].filter(Boolean).join('\n'),
    start: event.start_time ? stamp(event.start_date, event.start_time) : { date: event.start_date },
    end: event.start_time ? stamp(event.end_date || event.start_date, event.end_time) : { date: nextDay(event.end_date || event.start_date) },
    extendedProperties: { private: { moa: id } },
  };
}
