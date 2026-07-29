/**
 * The database gives back ISO timestamps down to the microsecond
 * (`2026-07-29T01:07:24.507908+00:00`), which is exactly what an operator
 * scanning a dashboard does not want to read. This renders in the viewer's
 * own local time zone, to the minute.
 */
export function formatDateTime(value: string | null): string {
  if (!value) return '未設定';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  return new Intl.DateTimeFormat('ja-JP', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);
}
