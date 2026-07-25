import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const workflow = JSON.parse(
  fs.readFileSync(path.join(root, 'workflows', '02-chatbot-lembretes-telegram.json'), 'utf8'),
);
const processSource = fs.readFileSync(
  path.join(root, 'workflow-sources', '02-reminder-chatbot', 'process-message.js'),
  'utf8',
).replace(/\r\n/g, '\n');
const dispatchSource = fs.readFileSync(
  path.join(root, 'workflow-sources', '02-reminder-chatbot', 'dispatch-due.js'),
  'utf8',
).replace(/\r\n/g, '\n');

assert.equal(workflow.name, '02 - Chatbot de lembretes - Telegram');
assert.equal(workflow.active, false);
assert.equal(workflow.settings.timezone, 'America/Sao_Paulo');

const nodeByName = new Map(workflow.nodes.map((node) => [node.name, node]));
assert.equal(nodeByName.get('Receber mensagem Telegram').typeVersion, 1.4);
assert.deepEqual(
  nodeByName.get('Receber mensagem Telegram').parameters.updates,
  ['message', 'callback_query'],
);
assert.equal(
  nodeByName.get('Processar mensagem e comandos').parameters.jsCode,
  processSource,
);
assert.equal(
  nodeByName.get('Buscar lembretes vencidos').parameters.jsCode,
  dispatchSource,
);
assert.equal(
  nodeByName.get('Pedir confirmacao').parameters.replyMarkup,
  'inlineKeyboard',
);
assert.equal(
  nodeByName.get('Enviar lembrete').parameters.inlineKeyboard.rows.length,
  2,
);

for (const [source, connection] of Object.entries(workflow.connections)) {
  assert.ok(nodeByName.has(source), `Node de origem ausente: ${source}`);
  for (const output of connection.main) {
    for (const edge of output) {
      assert.ok(nodeByName.has(edge.node), `Node de destino ausente: ${edge.node}`);
    }
  }
}

const processMessage = new Function('$input', '$getWorkflowStaticData', processSource);
const dispatchDue = new Function('$input', '$getWorkflowStaticData', dispatchSource);
const state = {};
const runMessage = (payload) => processMessage(
  { first: () => ({ json: payload }) },
  () => state,
);
const telegramMessage = (text) => ({
  message: {
    text,
    chat: { id: 123 },
    from: { id: 123 },
  },
});
const telegramCallback = (data, id = 'callback-id') => ({
  callback_query: {
    id,
    data,
    message: { chat: { id: 123 } },
    from: { id: 123 },
  },
});

let result = runMessage(
  telegramMessage('Me lembre amanh\u00e3 \u00e0s 09:30 de pagar a internet'),
);
assert.equal(result.length, 1);
assert.equal(result[0].json.hasKeyboard, true);
assert.match(result[0].json.reply, /pagar a internet/);
assert.ok(result[0].json.confirmData.length <= 64);

result = runMessage(telegramCallback(result[0].json.confirmData, 'confirm-1'));
assert.match(result[0].json.callbackText, /criado/);
assert.equal(state.reminders.length, 1);
assert.equal(state.reminders[0].status, 'active');

result = runMessage(telegramMessage('/listar'));
assert.match(result[0].json.reply, /pagar a internet/);

result = runMessage(
  telegramMessage('Todo dia \u00e0s 08h tomar o rem\u00e9dio'),
);
assert.equal(result[0].json.hasKeyboard, true);
assert.match(result[0].json.reply, /todos os dias/);
assert.match(result[0].json.reply, /tomar o rem/);
result = runMessage(telegramCallback(result[0].json.confirmData, 'confirm-daily'));
assert.match(result[0].json.callbackText, /criado/);
const dailyReminder = state.reminders.find((reminder) => reminder.recurrence?.type === 'daily');
assert.ok(dailyReminder);

result = runMessage(telegramMessage('Daqui a 20 minutos desligar o forno'));
assert.equal(result[0].json.hasKeyboard, true);
assert.match(result[0].json.reply, /desligar o forno/);

result = runMessage(
  telegramMessage('Daqui a 5 minutos revisar <script>alert(1)</script>'),
);
assert.doesNotMatch(result[0].json.reply, /<script>/);
assert.match(result[0].json.reply, /&lt;script&gt;/);

state.reminders[0].nextAt = Date.now() - 1000;
result = dispatchDue({ first: () => ({ json: {} }) }, () => state);
assert.equal(result.length, 1);
assert.match(result[0].json.message, /pagar a internet/);
assert.equal(state.reminders[0].status, 'sent');

result = runMessage(telegramCallback(result[0].json.snooze10Data, 'snooze-1'));
assert.match(result[0].json.callbackText, /adiado/);
assert.equal(state.reminders[0].status, 'active');
assert.ok(state.reminders[0].nextAt > Date.now());

result = runMessage(telegramMessage('/cancelar 1'));
assert.match(result[0].json.reply, /cancelado/);
assert.equal(state.reminders[0].status, 'cancelled');

dailyReminder.nextAt = Date.now() - 1000;
result = dispatchDue({ first: () => ({ json: {} }) }, () => state);
assert.equal(result.length, 1);
assert.equal(dailyReminder.status, 'active');
assert.ok(dailyReminder.nextAt > Date.now());
const recurringButtons = result[0].json;

result = runMessage(telegramCallback(recurringButtons.doneData, 'done-daily'));
assert.match(result[0].json.callbackText, /próxima recorrência continua ativa/);
assert.equal(dailyReminder.status, 'active');

const countBeforeRecurringSnooze = state.reminders.length;
result = runMessage(telegramCallback(recurringButtons.snooze10Data, 'snooze-daily'));
assert.match(result[0].json.callbackText, /Ocorrência adiada/);
assert.equal(state.reminders.length, countBeforeRecurringSnooze + 1);
assert.equal(dailyReminder.status, 'active');
assert.equal(state.reminders.at(-1).recurrence, null);

result = runMessage(telegramMessage('/ajuda'));
assert.match(result[0].json.reply, /Chatbot de lembretes/);

console.log('Workflow 02 validado com sucesso.');
