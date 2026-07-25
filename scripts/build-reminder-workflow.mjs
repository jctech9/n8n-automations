import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(scriptDirectory, '..');
const readSource = (name) => fs.readFileSync(
  path.join(root, 'workflow-sources', '02-reminder-chatbot', name),
  'utf8',
).replace(/\r\n/g, '\n');

const processMessageCode = readSource('process-message.js');
const dispatchDueCode = readSource('dispatch-due.js');

const workflow = {
  name: '02 - Chatbot de lembretes - Telegram',
  nodes: [
    {
      parameters: {
        updates: ['message', 'callback_query'],
        additionalFields: {
          chatIds: 'SUBSTITUA_PELO_CHAT_ID',
        },
      },
      id: '29652a99-70f0-4784-9a44-e20ac892cd1d',
      name: 'Receber mensagem Telegram',
      type: 'n8n-nodes-base.telegramTrigger',
      typeVersion: 1.4,
      position: [-760, 40],
    },
    {
      parameters: {
        jsCode: processMessageCode,
      },
      id: '104e090a-2094-4652-ac30-406dd078959c',
      name: 'Processar mensagem e comandos',
      type: 'n8n-nodes-base.code',
      typeVersion: 2,
      position: [-500, 40],
    },
    {
      parameters: {
        conditions: {
          options: {
            caseSensitive: true,
            leftValue: '',
            typeValidation: 'strict',
            version: 3,
          },
          conditions: [
            {
              id: '8cb4b827-c21c-49c1-9b4d-34662b3e90cc',
              leftValue: '={{ $json.isCallback }}',
              rightValue: '',
              operator: {
                type: 'boolean',
                operation: 'true',
                singleValue: true,
              },
            },
          ],
          combinator: 'and',
        },
        options: {},
      },
      id: 'fd45c49d-2828-452f-b8b0-111cbdfb0e57',
      name: 'E resposta de botao',
      type: 'n8n-nodes-base.if',
      typeVersion: 2.3,
      position: [-240, 40],
    },
    {
      parameters: {
        resource: 'callback',
        operation: 'answerQuery',
        queryId: '={{ $json.queryId }}',
        additionalFields: {
          cache_time: 0,
          show_alert: '={{ $json.showAlert }}',
          text: '={{ $json.callbackText }}',
        },
      },
      id: '7098513e-381c-4119-8cc1-7c662d6d4c69',
      name: 'Responder botao',
      type: 'n8n-nodes-base.telegram',
      typeVersion: 1.2,
      position: [20, -100],
      retryOnFail: true,
      maxTries: 3,
      waitBetweenTries: 1000,
    },
    {
      parameters: {
        conditions: {
          options: {
            caseSensitive: true,
            leftValue: '',
            typeValidation: 'strict',
            version: 3,
          },
          conditions: [
            {
              id: '158651f5-23aa-4f70-93b5-c11cb7e085e0',
              leftValue: '={{ $json.hasKeyboard }}',
              rightValue: '',
              operator: {
                type: 'boolean',
                operation: 'true',
                singleValue: true,
              },
            },
          ],
          combinator: 'and',
        },
        options: {},
      },
      id: 'c8a71bed-bbab-4125-b624-9ab75cbdc96a',
      name: 'Precisa confirmar',
      type: 'n8n-nodes-base.if',
      typeVersion: 2.3,
      position: [20, 120],
    },
    {
      parameters: {
        resource: 'message',
        operation: 'sendMessage',
        chatId: '={{ $json.chatId }}',
        text: '={{ $json.reply }}',
        replyMarkup: 'inlineKeyboard',
        inlineKeyboard: {
          rows: [
            {
              row: {
                buttons: [
                  {
                    text: '✅ Confirmar',
                    additionalFields: {
                      callback_data: '={{ $json.confirmData }}',
                    },
                  },
                  {
                    text: '❌ Descartar',
                    additionalFields: {
                      callback_data: '={{ $json.discardData }}',
                    },
                  },
                ],
              },
            },
          ],
        },
        additionalFields: {
          appendAttribution: false,
          parse_mode: 'HTML',
        },
      },
      id: 'e6787fe9-115d-4b0e-a298-059230dbb2c2',
      name: 'Pedir confirmacao',
      type: 'n8n-nodes-base.telegram',
      typeVersion: 1.2,
      position: [300, 60],
      retryOnFail: true,
      maxTries: 3,
      waitBetweenTries: 1000,
    },
    {
      parameters: {
        resource: 'message',
        operation: 'sendMessage',
        chatId: '={{ $json.chatId }}',
        text: '={{ $json.reply }}',
        additionalFields: {
          appendAttribution: false,
          parse_mode: 'HTML',
        },
      },
      id: '95518884-d30c-4cf4-9669-b18c04421425',
      name: 'Responder mensagem',
      type: 'n8n-nodes-base.telegram',
      typeVersion: 1.2,
      position: [300, 200],
      retryOnFail: true,
      maxTries: 3,
      waitBetweenTries: 1000,
    },
    {
      parameters: {
        rule: {
          interval: [
            {
              field: 'minutes',
              minutesInterval: 1,
            },
          ],
        },
      },
      id: '8ac7ac32-0821-4978-9f85-89d76a87d89d',
      name: 'Verificar a cada minuto',
      type: 'n8n-nodes-base.scheduleTrigger',
      typeVersion: 1.3,
      position: [-500, 500],
    },
    {
      parameters: {
        jsCode: dispatchDueCode,
      },
      id: 'cbd25f66-b7eb-4ec2-b03e-8c87e8e115a5',
      name: 'Buscar lembretes vencidos',
      type: 'n8n-nodes-base.code',
      typeVersion: 2,
      position: [-220, 500],
    },
    {
      parameters: {
        resource: 'message',
        operation: 'sendMessage',
        chatId: '={{ $json.chatId }}',
        text: '={{ $json.message }}',
        replyMarkup: 'inlineKeyboard',
        inlineKeyboard: {
          rows: [
            {
              row: {
                buttons: [
                  {
                    text: '✅ Concluído',
                    additionalFields: {
                      callback_data: '={{ $json.doneData }}',
                    },
                  },
                ],
              },
            },
            {
              row: {
                buttons: [
                  {
                    text: '⏱ +10 min',
                    additionalFields: {
                      callback_data: '={{ $json.snooze10Data }}',
                    },
                  },
                  {
                    text: '🕐 +1 hora',
                    additionalFields: {
                      callback_data: '={{ $json.snooze60Data }}',
                    },
                  },
                ],
              },
            },
          ],
        },
        additionalFields: {
          appendAttribution: false,
          parse_mode: 'HTML',
        },
      },
      id: '94e479f8-186e-4eac-a39c-31034ee9a945',
      name: 'Enviar lembrete',
      type: 'n8n-nodes-base.telegram',
      typeVersion: 1.2,
      position: [60, 500],
      retryOnFail: true,
      maxTries: 3,
      waitBetweenTries: 2000,
    },
    {
      parameters: {
        content: '## Configuração obrigatória\n\n1. Troque `SUBSTITUA_PELO_CHAT_ID` no node **Receber mensagem Telegram**.\n2. Selecione a mesma credencial do bot nos cinco nodes Telegram.\n3. Publique/ative o workflow para registrar o webhook.\n4. Envie `/ajuda` ao bot.\n\nO Telegram permite somente um Telegram Trigger ativo por bot.',
        height: 320,
        width: 500,
        color: 5,
      },
      id: 'e4ebc5de-2acf-48a1-bfa7-8710f9dfba97',
      name: 'Configurar antes de ativar',
      type: 'n8n-nodes-base.stickyNote',
      typeVersion: 1,
      position: [-780, -380],
    },
    {
      parameters: {
        content: '## Recursos\n\n- Linguagem natural em português\n- Confirmação por botões\n- `/listar`, `/hoje`, `/cancelar ID`\n- Lembretes diários e semanais\n- Concluir ou adiar por 10/60 minutos\n- Estado persistente no próprio workflow\n- Fuso `America/Sao_Paulo`',
        height: 300,
        width: 440,
        color: 4,
      },
      id: '84105a9f-10dc-42d5-8f25-59fe4dc34be9',
      name: 'Recursos do chatbot',
      type: 'n8n-nodes-base.stickyNote',
      typeVersion: 1,
      position: [60, -360],
    },
  ],
  pinData: {},
  connections: {
    'Receber mensagem Telegram': {
      main: [[{ node: 'Processar mensagem e comandos', type: 'main', index: 0 }]],
    },
    'Processar mensagem e comandos': {
      main: [[{ node: 'E resposta de botao', type: 'main', index: 0 }]],
    },
    'E resposta de botao': {
      main: [
        [{ node: 'Responder botao', type: 'main', index: 0 }],
        [{ node: 'Precisa confirmar', type: 'main', index: 0 }],
      ],
    },
    'Precisa confirmar': {
      main: [
        [{ node: 'Pedir confirmacao', type: 'main', index: 0 }],
        [{ node: 'Responder mensagem', type: 'main', index: 0 }],
      ],
    },
    'Verificar a cada minuto': {
      main: [[{ node: 'Buscar lembretes vencidos', type: 'main', index: 0 }]],
    },
    'Buscar lembretes vencidos': {
      main: [[{ node: 'Enviar lembrete', type: 'main', index: 0 }]],
    },
  },
  active: false,
  settings: {
    executionOrder: 'v1',
    timezone: 'America/Sao_Paulo',
  },
  versionId: 'f10c6823-5ccf-4d10-8117-7453732f8f07',
  meta: {
    templateCredsSetupCompleted: false,
  },
  tags: [],
};

const output = path.join(root, 'workflows', '02-chatbot-lembretes-telegram.json');
fs.writeFileSync(output, `${JSON.stringify(workflow, null, 2)}\n`, 'utf8');
console.log(`Gerado: ${path.relative(root, output)}`);
