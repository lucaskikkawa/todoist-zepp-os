import { Time } from '@zos/sensor';
const time = new Time();
function pad(value) { return String(value).padStart(2, '0'); }
export function watchContext() {
  const millis = time.getTime();
  const localDate = `${time.getFullYear()}-${pad(time.getMonth())}-${pad(time.getDate())}`;
  const localTime = `${pad(time.getHours())}:${pad(time.getMinutes())}:${pad(time.getSeconds())}`;
  const localAsUtc = new Date(`${localDate}T${localTime}.000Z`).getTime();
  const timezoneOffsetMinutes = Math.round((millis - localAsUtc) / 60000);
  const offset = -timezoneOffsetMinutes;
  const timezone = `UTC${offset < 0 ? '-' : '+'}${pad(Math.floor(Math.abs(offset) / 60))}:${pad(Math.abs(offset) % 60)}`;
  return { completedAt: new Date(millis).toISOString(), localDate, timezone, timezoneOffsetMinutes };
}
