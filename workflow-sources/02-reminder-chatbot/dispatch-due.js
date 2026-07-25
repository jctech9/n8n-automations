const CONFIG = {
  timezone: 'America/Sao_Paulo',
  maxPerRun: 50,
};

const state = $getWorkflowStaticData('global');
state.reminders = Array.isArray(state.reminders) ? state.reminders : [];
const now = Date.now();

const escapeHtml = (value) => String(value ?? '')
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;');
const partsFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: CONFIG.timezone,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});
const localParts = (timestamp) => {
  const result = {};
  for (const part of partsFormatter.formatToParts(new Date(timestamp))) {
    if (part.type !== 'literal') result[part.type] = Number(part.value);
  }
  return result;
};
const zonedToUtc = (year, month, day, hour, minute) => {
  const desired = Date.UTC(year, month - 1, day, hour, minute, 0);
  let candidate = desired;
  for (let attempt = 0; attempt < 3; attempt++) {
    const actual = localParts(candidate);
    const represented = Date.UTC(
      actual.year,
      actual.month - 1,
      actual.day,
      actual.hour,
      actual.minute,
      0,
    );
    candidate += desired - represented;
  }
  return candidate;
};
const shiftLocalDays = (timestamp, days) => {
  const parts = localParts(timestamp);
  const shifted = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days));
  return zonedToUtc(
    shifted.getUTCFullYear(),
    shifted.getUTCMonth() + 1,
    shifted.getUTCDate(),
    parts.hour,
    parts.minute,
  );
};
const nextOccurrence = (reminder) => {
  let candidate = Number(reminder.nextAt);
  const stepDays = reminder.recurrence?.type === 'weekly' ? 7 : 1;
  let guard = 0;
  do {
    candidate = shiftLocalDays(candidate, stepDays);
    guard++;
  } while (candidate <= now && guard < 370);
  return candidate;
};

const due = state.reminders
  .filter((reminder) => reminder.status === 'active' && Number(reminder.nextAt) <= now)
  .sort((a, b) => Number(a.nextAt) - Number(b.nextAt))
  .slice(0, CONFIG.maxPerRun);

const output = [];
for (const reminder of due) {
  const occurrenceAt = Number(reminder.nextAt);
  reminder.lastSentAt = now;
  reminder.updatedAt = now;

  if (reminder.recurrence) {
    reminder.nextAt = nextOccurrence(reminder);
  } else {
    reminder.status = 'sent';
    reminder.sentAt = now;
  }

  const recurrenceText = reminder.recurrence
    ? '\n\nEste lembrete é recorrente; a próxima ocorrência já foi agendada.'
    : '';
  output.push({
    json: {
      chatId: reminder.chatId,
      reminderId: reminder.id,
      doneData: `done:${reminder.id}`,
      snooze10Data: `snooze:10:${reminder.id}`,
      snooze60Data: `snooze:60:${reminder.id}`,
      message: `⏰ <b>LEMBRETE #${reminder.id}</b>\n\n${escapeHtml(reminder.text)}${recurrenceText}`,
      occurrenceAt,
    },
  });
}

return output;
