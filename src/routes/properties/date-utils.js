export function currentUnixSeconds() {
  return Math.floor(Date.now() / 1000);
}

export function isIsoDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
}

export function parseDateUtc(value) {
  return new Date(`${value}T00:00:00Z`);
}

export function formatDateUtc(date) {
  return date.toISOString().slice(0, 10);
}

export function formatDateParts(parts) {
  return `${String(parts.year).padStart(4, '0')}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`;
}

export function getTimeZoneDateTimeParts(timestamp = new Date(), timeZone = 'Asia/Ho_Chi_Minh') {
  const date = timestamp instanceof Date ? timestamp : new Date(timestamp);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    hour12: false,
  }).formatToParts(date);
  const get = (type) => parseInt(parts.find((part) => part.type === type)?.value ?? '0', 10);
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour: get('hour'),
    minute: get('minute'),
  };
}

export function addDays(date, days) {
  const next = new Date(date.getTime());
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

export function enumerateStayDates(checkIn, checkOut) {
  const dates = [];
  for (let cursor = parseDateUtc(checkIn); cursor < parseDateUtc(checkOut); cursor = addDays(cursor, 1)) {
    dates.push(formatDateUtc(cursor));
  }
  return dates;
}

export function enumerateDateRange(startDate, endDate) {
  const dates = [];
  for (let cursor = new Date(startDate.getTime()); cursor <= endDate; cursor = addDays(cursor, 1)) {
    dates.push(formatDateUtc(cursor));
  }
  return dates;
}