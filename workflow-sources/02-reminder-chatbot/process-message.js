const CONFIG = {
  timezone: 'America/Sao_Paulo',
  pendingMinutes: 30,
  retentionDays: 90,
  maxRemindersPerChat: 500,
  listLimit: 20,
};

const input = $input.first().json;
const state = $getWorkflowStaticData('global');
state.reminders = Array.isArray(state.reminders) ? state.reminders : [];
state.pending = state.pending && typeof state.pending === 'object' ? state.pending : {};
state.nextId = Number.isInteger(state.nextId) && state.nextId > 0 ? state.nextId : 1;

const now = Date.now();
const retentionCutoff = now - CONFIG.retentionDays * 86400000;
for (const [key, pending] of Object.entries(state.pending)) {
  if (!pending || Number(pending.expiresAt) < now) delete state.pending[key];
}
state.reminders = state.reminders.filter((reminder) => {
  if (!['completed', 'cancelled'].includes(reminder.status)) return true;
  return Number(reminder.updatedAt || reminder.createdAt || 0) >= retentionCutoff;
});

const escapeHtml = (value) => String(value ?? '')
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;');
const normalize = (value) => String(value ?? '')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase();
const dateFormatter = new Intl.DateTimeFormat('pt-BR', {
  timeZone: CONFIG.timezone,
  weekday: 'short',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});
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
const shiftCalendarDate = (year, month, day, days) => {
  const shifted = new Date(Date.UTC(year, month - 1, day + days));
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  };
};
const timestampForDayOffset = (baseTimestamp, days, hour, minute) => {
  const base = localParts(baseTimestamp);
  const shifted = shiftCalendarDate(base.year, base.month, base.day, days);
  return zonedToUtc(shifted.year, shifted.month, shifted.day, hour, minute);
};
const localDateKey = (timestamp) => {
  const parts = localParts(timestamp);
  return `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`;
};
const formatDate = (timestamp) => dateFormatter
  .format(new Date(timestamp))
  .replace(/, (\d{2}:\d{2})$/, ' às $1');
const recurrenceLabel = (recurrence) => {
  if (!recurrence) return 'não se repete';
  if (recurrence.type === 'daily') return 'todos os dias';
  if (recurrence.type === 'weekly') return `toda ${recurrence.weekdayName}`;
  return 'personalizada';
};
const helpMessage = [
  '🤖 <b>Chatbot de lembretes</b>',
  '',
  'Envie frases como:',
  '• <code>Me lembre amanhã às 09:30 de pagar a internet</code>',
  '• <code>Daqui a 20 minutos desligar o forno</code>',
  '• <code>Todo dia às 08h tomar o remédio</code>',
  '• <code>Toda segunda às 10h enviar o relatório</code>',
  '• <code>Dia 05/08 às 14h renovar o documento</code>',
  '',
  '<b>Comandos</b>',
  '/listar — próximos lembretes',
  '/hoje — lembretes de hoje',
  '/cancelar 12 — cancelar pelo número',
  '/ajuda — mostrar esta ajuda',
  '',
  `Fuso horário: <code>${CONFIG.timezone}</code>`,
].join('\n');

const callback = input.callback_query;
const message = input.message;
const chatId = String(callback?.message?.chat?.id ?? message?.chat?.id ?? '');
const userId = String(callback?.from?.id ?? message?.from?.id ?? '');

if (!chatId) return [];

if (callback) {
  const callbackData = String(callback.data || '');
  const result = {
    isCallback: true,
    queryId: String(callback.id || ''),
    callbackText: 'Ação não reconhecida.',
    showAlert: false,
    chatId,
  };

  const confirmation = callbackData.match(/^(confirm|discard):([a-z0-9]+)$/i);
  if (confirmation) {
    const action = confirmation[1].toLowerCase();
    const token = confirmation[2];
    const key = `${chatId}:${token}`;
    const pending = state.pending[key];

    if (!pending || Number(pending.expiresAt) < now) {
      delete state.pending[key];
      result.callbackText = 'Esta confirmação expirou. Envie o lembrete novamente.';
      result.showAlert = true;
      return [{ json: result }];
    }

    if (action === 'discard') {
      delete state.pending[key];
      result.callbackText = 'Lembrete descartado.';
      return [{ json: result }];
    }

    const activeCount = state.reminders.filter(
      (reminder) => reminder.chatId === chatId && ['active', 'sent'].includes(reminder.status),
    ).length;
    if (activeCount >= CONFIG.maxRemindersPerChat) {
      result.callbackText = `Limite de ${CONFIG.maxRemindersPerChat} lembretes atingido.`;
      result.showAlert = true;
      return [{ json: result }];
    }

    const reminder = {
      id: state.nextId++,
      chatId,
      userId,
      text: pending.text,
      nextAt: pending.nextAt,
      recurrence: pending.recurrence || null,
      status: 'active',
      createdAt: now,
      updatedAt: now,
    };
    state.reminders.push(reminder);
    delete state.pending[key];
    result.callbackText = `Lembrete #${reminder.id} criado para ${formatDate(reminder.nextAt)}.`;
    return [{ json: result }];
  }

  const done = callbackData.match(/^done:(\d+)$/);
  if (done) {
    const id = Number(done[1]);
    const reminder = state.reminders.find((item) => item.id === id && item.chatId === chatId);
    if (!reminder) {
      result.callbackText = 'Lembrete não encontrado.';
      result.showAlert = true;
      return [{ json: result }];
    }
    if (reminder.recurrence) {
      reminder.lastAcknowledgedAt = now;
      reminder.updatedAt = now;
      result.callbackText = `Lembrete #${id} concluído. A próxima recorrência continua ativa.`;
    } else {
      reminder.status = 'completed';
      reminder.completedAt = now;
      reminder.updatedAt = now;
      result.callbackText = `Lembrete #${id} concluído.`;
    }
    return [{ json: result }];
  }

  const snooze = callbackData.match(/^snooze:(10|60):(\d+)$/);
  if (snooze) {
    const minutes = Number(snooze[1]);
    const id = Number(snooze[2]);
    const reminder = state.reminders.find((item) => item.id === id && item.chatId === chatId);
    if (!reminder) {
      result.callbackText = 'Lembrete não encontrado.';
      result.showAlert = true;
      return [{ json: result }];
    }

    if (reminder.recurrence) {
      const snoozed = {
        id: state.nextId++,
        chatId,
        userId,
        text: reminder.text,
        nextAt: now + minutes * 60000,
        recurrence: null,
        status: 'active',
        parentId: reminder.id,
        createdAt: now,
        updatedAt: now,
      };
      state.reminders.push(snoozed);
      result.callbackText = `Ocorrência adiada por ${minutes} minutos (#${snoozed.id}).`;
    } else {
      reminder.nextAt = now + minutes * 60000;
      reminder.status = 'active';
      reminder.snoozedAt = now;
      reminder.updatedAt = now;
      result.callbackText = `Lembrete #${id} adiado por ${minutes} minutos.`;
    }
    return [{ json: result }];
  }

  return [{ json: result }];
}

const rawText = String(message?.text || '').trim();
if (!rawText) {
  return [{ json: {
    isCallback: false,
    hasKeyboard: false,
    chatId,
    reply: 'Envie uma mensagem de texto com o lembrete. Use /ajuda para ver exemplos.',
  } }];
}

const command = normalize(rawText.split(/\s+/)[0]).split('@')[0];
if (['/start', '/ajuda', '/help'].includes(command)) {
  return [{ json: { isCallback: false, hasKeyboard: false, chatId, reply: helpMessage } }];
}

if (command === '/listar' || command === '/hoje') {
  let reminders = state.reminders.filter(
    (reminder) => reminder.chatId === chatId && ['active', 'sent'].includes(reminder.status),
  );
  if (command === '/hoje') {
    const today = localDateKey(now);
    reminders = reminders.filter(
      (reminder) => reminder.status === 'active' && localDateKey(reminder.nextAt) === today,
    );
  }
  reminders.sort((a, b) => Number(a.nextAt) - Number(b.nextAt));
  const total = reminders.length;
  const visible = reminders.slice(0, CONFIG.listLimit);
  const title = command === '/hoje' ? '📅 <b>Lembretes de hoje</b>' : '📋 <b>Próximos lembretes</b>';
  const lines = visible.map((reminder) => {
    const status = reminder.status === 'sent' ? 'aguardando ação' : formatDate(reminder.nextAt);
    const repeat = reminder.recurrence ? ` · ${recurrenceLabel(reminder.recurrence)}` : '';
    return `<b>#${reminder.id}</b> — ${escapeHtml(reminder.text)}\n${escapeHtml(status)}${escapeHtml(repeat)}`;
  });
  const suffix = total > visible.length ? `\n\n...e mais ${total - visible.length}.` : '';
  const reply = lines.length ? `${title}\n\n${lines.join('\n\n')}${suffix}` : `${title}\n\nNenhum lembrete encontrado.`;
  return [{ json: { isCallback: false, hasKeyboard: false, chatId, reply } }];
}

if (command === '/cancelar') {
  const id = Number(rawText.match(/^\/cancelar(?:@\w+)?\s+(\d+)/i)?.[1]);
  if (!id) {
    return [{ json: {
      isCallback: false,
      hasKeyboard: false,
      chatId,
      reply: 'Uso correto: <code>/cancelar 12</code>',
    } }];
  }
  const reminder = state.reminders.find(
    (item) => item.id === id && item.chatId === chatId && ['active', 'sent'].includes(item.status),
  );
  if (!reminder) {
    return [{ json: {
      isCallback: false,
      hasKeyboard: false,
      chatId,
      reply: `Não encontrei um lembrete ativo com o número <b>#${id}</b>.`,
    } }];
  }
  reminder.status = 'cancelled';
  reminder.cancelledAt = now;
  reminder.updatedAt = now;
  return [{ json: {
    isCallback: false,
    hasKeyboard: false,
    chatId,
    reply: `🗑️ Lembrete <b>#${id}</b> cancelado.`,
  } }];
}

const weekdayDefinitions = [
  { index: 0, names: ['domingo'], label: 'domingo' },
  { index: 1, names: ['segunda', 'segunda-feira'], label: 'segunda-feira' },
  { index: 2, names: ['terca', 'terca-feira'], label: 'terça-feira' },
  { index: 3, names: ['quarta', 'quarta-feira'], label: 'quarta-feira' },
  { index: 4, names: ['quinta', 'quinta-feira'], label: 'quinta-feira' },
  { index: 5, names: ['sexta', 'sexta-feira'], label: 'sexta-feira' },
  { index: 6, names: ['sabado'], label: 'sábado' },
];
const normalizedText = normalize(rawText);
const findWeekday = (text) => weekdayDefinitions.find(
  (weekday) => weekday.names.some((name) => new RegExp(`\\b${name}\\b`).test(text)),
);
const extractTime = (text) => {
  const patterns = [
    /\b(?:as)\s*(\d{1,2})(?:(?::|h)(\d{2}))?\s*(?:horas?)?\b/i,
    /\b(\d{1,2})h(?:(\d{2}))?\b/i,
    /\b(\d{1,2}):(\d{2})\b/i,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match) continue;
    const hour = Number(match[1]);
    const minute = Number(match[2] || 0);
    if (hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59) return { hour, minute };
  }
  return null;
};

const relativeMatch = normalizedText.match(/\bdaqui\s+a\s+(\d+)\s*(minutos?|mins?|horas?|dias?)\b/i);
let nextAt = 0;
let recurrence = null;
let parseError = '';
let time = extractTime(normalizedText);
let recognizedDate = false;

const daily = /\b(todo\s+dia|todos\s+os\s+dias|diariamente)\b/i.test(normalizedText);
const weeklyMatch = normalizedText.match(/\btod[ao]\s+(domingo|segunda(?:-feira)?|terca(?:-feira)?|quarta(?:-feira)?|quinta(?:-feira)?|sexta(?:-feira)?|sabado)\b/i);
const weeklyDay = weeklyMatch ? findWeekday(weeklyMatch[1]) : null;

if (relativeMatch) {
  const amount = Number(relativeMatch[1]);
  const unit = relativeMatch[2];
  const multiplier = unit.startsWith('min') ? 60000 : unit.startsWith('hora') ? 3600000 : 86400000;
  nextAt = now + amount * multiplier;
  recognizedDate = amount > 0;
  if (!recognizedDate) parseError = 'O intervalo precisa ser maior que zero.';
} else {
  if (!time) {
    parseError = 'Não consegui identificar o horário. Exemplos: <code>às 09:30</code> ou <code>às 9h</code>.';
  } else if (daily) {
    recurrence = { type: 'daily' };
    nextAt = timestampForDayOffset(now, 0, time.hour, time.minute);
    if (nextAt <= now) nextAt = timestampForDayOffset(now, 1, time.hour, time.minute);
    recognizedDate = true;
  } else if (weeklyDay) {
    recurrence = {
      type: 'weekly',
      weekday: weeklyDay.index,
      weekdayName: weeklyDay.label,
    };
    const todayParts = localParts(now);
    const todayWeekday = new Date(Date.UTC(todayParts.year, todayParts.month - 1, todayParts.day)).getUTCDay();
    let daysAhead = (weeklyDay.index - todayWeekday + 7) % 7;
    nextAt = timestampForDayOffset(now, daysAhead, time.hour, time.minute);
    if (nextAt <= now) {
      daysAhead += 7;
      nextAt = timestampForDayOffset(now, daysAhead, time.hour, time.minute);
    }
    recognizedDate = true;
  } else {
    const current = localParts(now);
    if (/\bamanha\b/i.test(normalizedText)) {
      nextAt = timestampForDayOffset(now, 1, time.hour, time.minute);
      recognizedDate = true;
    } else if (/\bhoje\b/i.test(normalizedText)) {
      nextAt = timestampForDayOffset(now, 0, time.hour, time.minute);
      recognizedDate = true;
      if (nextAt <= now) parseError = 'Esse horário de hoje já passou.';
    } else {
      const dateMatch = normalizedText.match(/\b(?:dia\s+)?(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/);
      if (dateMatch) {
        const day = Number(dateMatch[1]);
        const month = Number(dateMatch[2]);
        let year = dateMatch[3] ? Number(dateMatch[3]) : current.year;
        if (year < 100) year += 2000;
        nextAt = zonedToUtc(year, month, day, time.hour, time.minute);
        const check = localParts(nextAt);
        if (check.year !== year || check.month !== month || check.day !== day) {
          parseError = 'A data informada não existe.';
        } else if (!dateMatch[3] && nextAt <= now) {
          year += 1;
          nextAt = zonedToUtc(year, month, day, time.hour, time.minute);
        }
        recognizedDate = true;
      } else {
        const weekday = findWeekday(normalizedText);
        if (weekday) {
          const todayWeekday = new Date(Date.UTC(current.year, current.month - 1, current.day)).getUTCDay();
          let daysAhead = (weekday.index - todayWeekday + 7) % 7;
          nextAt = timestampForDayOffset(now, daysAhead, time.hour, time.minute);
          if (nextAt <= now) {
            daysAhead += 7;
            nextAt = timestampForDayOffset(now, daysAhead, time.hour, time.minute);
          }
          recognizedDate = true;
        } else {
          nextAt = timestampForDayOffset(now, 0, time.hour, time.minute);
          if (nextAt <= now) nextAt = timestampForDayOffset(now, 1, time.hour, time.minute);
          recognizedDate = true;
        }
      }
    }
  }
}

let reminderText = rawText
  .replace(/^(?:me\s+)?lembre(?:-me)?(?:\s+de)?\s*/i, '')
  .replace(/\bdaqui\s+a\s+\d+\s*(?:minutos?|mins?|horas?|dias?)\b/gi, '')
  .replace(/\b(?:todo\s+dia|todos\s+os\s+dias|diariamente)\b/gi, '')
  .replace(/\btod[ao]\s+(?:domingo|segunda(?:-feira)?|terça(?:-feira)?|terca(?:-feira)?|quarta(?:-feira)?|quinta(?:-feira)?|sexta(?:-feira)?|sábado|sabado)\b/gi, '')
  .replace(/\b(?:hoje|amanhã|amanha)\b/gi, '')
  .replace(/\b(?:dia\s+)?\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b/gi, '')
  .replace(/\b(?:próxima|proxima)?\s*(?:domingo|segunda(?:-feira)?|terça(?:-feira)?|terca(?:-feira)?|quarta(?:-feira)?|quinta(?:-feira)?|sexta(?:-feira)?|sábado|sabado)\b/gi, '')
  .replace(/\b(?:às|as)\s*\d{1,2}(?::\d{2}|h\d{0,2})?\s*(?:horas?)?\b/gi, '')
  .replace(/\b\d{1,2}h(?:\d{2})?\b/gi, '')
  .replace(/\b\d{1,2}:\d{2}\b/gi, '')
  .replace(/^\s*(?:de|para)\s+/i, '')
  .replace(/\s+/g, ' ')
  .replace(/^[,;:\-–—.\s]+|[,;:\-–—.\s]+$/g, '')
  .trim();

if (!recognizedDate && !parseError) {
  parseError = 'Não consegui identificar quando devo lembrar.';
}
if (!reminderText) {
  parseError = 'Não consegui identificar o texto do lembrete.';
}
if (nextAt && nextAt < now + 15000) {
  parseError = 'O horário precisa estar no futuro.';
}

if (parseError) {
  return [{ json: {
    isCallback: false,
    hasKeyboard: false,
    chatId,
    reply: `⚠️ ${parseError}\n\nUse /ajuda para ver exemplos.`,
  } }];
}

const token = `${now.toString(36)}${Math.random().toString(36).slice(2, 8)}`;
const key = `${chatId}:${token}`;
state.pending[key] = {
  token,
  chatId,
  userId,
  text: reminderText,
  nextAt,
  recurrence,
  createdAt: now,
  expiresAt: now + CONFIG.pendingMinutes * 60000,
};

const recurrenceText = recurrence ? `\n<b>Repetição:</b> ${escapeHtml(recurrenceLabel(recurrence))}` : '';
return [{ json: {
  isCallback: false,
  hasKeyboard: true,
  chatId,
  confirmData: `confirm:${token}`,
  discardData: `discard:${token}`,
  reply: `🔔 <b>Confirmar lembrete</b>\n\n<b>Mensagem:</b> ${escapeHtml(reminderText)}\n<b>Quando:</b> ${escapeHtml(formatDate(nextAt))}${recurrenceText}\n\nConfirme em até ${CONFIG.pendingMinutes} minutos.`,
} }];
