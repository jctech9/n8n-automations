import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, '..');
const sourceDirectory = path.join(repositoryRoot, 'workflow-sources', '03-news-quixada');

const [selectNewLinksCode, filterAndMessageCode] = await Promise.all([
  readFile(path.join(sourceDirectory, 'select-new-links.js'), 'utf8'),
  readFile(path.join(sourceDirectory, 'filter-and-message.js'), 'utf8'),
]);

const stableId = (name) => {
  const hash = createHash('sha256').update(`news-quixada:${name}`).digest('hex');
  return [
    hash.slice(0, 8),
    hash.slice(8, 12),
    `4${hash.slice(13, 16)}`,
    `a${hash.slice(17, 20)}`,
    hash.slice(20, 32),
  ].join('-');
};

const rssNode = (name, url, position) => ({
  parameters: {
    url,
    options: {
      customFields: 'content:encoded,content:encodedSnippet,dc:creator',
    },
  },
  id: stableId(name),
  name,
  type: 'n8n-nodes-base.rssFeedRead',
  typeVersion: 1.2,
  position,
  retryOnFail: true,
  maxTries: 3,
  waitBetweenTries: 2000,
  onError: 'continueRegularOutput',
});

const sourceNode = (name, source, feedMode, feedUrl, position) => ({
  parameters: {
    assignments: {
      assignments: [
        {
          id: stableId(`${name}:source`),
          name: '_source',
          value: source,
          type: 'string',
        },
        {
          id: stableId(`${name}:mode`),
          name: '_feedMode',
          value: feedMode,
          type: 'string',
        },
        {
          id: stableId(`${name}:url`),
          name: '_feedUrl',
          value: feedUrl,
          type: 'string',
        },
      ],
    },
    includeOtherFields: true,
    options: {},
  },
  id: stableId(name),
  name,
  type: 'n8n-nodes-base.set',
  typeVersion: 3.4,
  position,
});

const connection = (node, index = 0) => ({ node, type: 'main', index });

const feeds = {
  revistaGeneral: {
    node: 'Ler Revista Central - geral',
    marker: 'Marcar Revista Central - geral',
    url: 'https://revistacentral.com.br/feed/',
  },
  revistaSearch: {
    node: 'Ler Revista Central - busca Quixada',
    marker: 'Marcar Revista Central - busca',
    url: 'https://revistacentral.com.br/?s=Quixad%C3%A1&feed=rss2',
  },
  monolitosGeneral: {
    node: 'Ler Monolitos Post - geral',
    marker: 'Marcar Monolitos Post - geral',
    url: 'https://www.monolitospost.com/feed/',
  },
  monolitosSearch: {
    node: 'Ler Monolitos Post - busca Quixada',
    marker: 'Marcar Monolitos Post - busca',
    url: 'https://www.monolitospost.com/?s=Quixad%C3%A1&feed=rss2',
  },
};

const workflow = {
  name: '03 - Notícias de Quixadá - Telegram',
  nodes: [
    {
      parameters: {},
      id: stableId('Teste manual'),
      name: 'Teste manual',
      type: 'n8n-nodes-base.manualTrigger',
      typeVersion: 1,
      position: [-1420, -940],
    },
    {
      parameters: {
        rule: {
          interval: [{ field: 'minutes', minutesInterval: 5 }],
        },
      },
      id: stableId('A cada 5 minutos'),
      name: 'A cada 5 minutos',
      type: 'n8n-nodes-base.scheduleTrigger',
      typeVersion: 1.3,
      position: [-1420, -740],
    },
    rssNode(feeds.revistaGeneral.node, feeds.revistaGeneral.url, [-1120, -980]),
    rssNode(feeds.revistaSearch.node, feeds.revistaSearch.url, [-1120, -700]),
    rssNode(feeds.monolitosGeneral.node, feeds.monolitosGeneral.url, [-1120, -420]),
    rssNode(feeds.monolitosSearch.node, feeds.monolitosSearch.url, [-1120, -140]),
    sourceNode(
      feeds.revistaGeneral.marker,
      'Revista Central',
      'general',
      feeds.revistaGeneral.url,
      [-840, -980],
    ),
    sourceNode(
      feeds.revistaSearch.marker,
      'Revista Central',
      'search',
      feeds.revistaSearch.url,
      [-840, -700],
    ),
    sourceNode(
      feeds.monolitosGeneral.marker,
      'Monolitos Post',
      'general',
      feeds.monolitosGeneral.url,
      [-840, -420],
    ),
    sourceNode(
      feeds.monolitosSearch.marker,
      'Monolitos Post',
      'search',
      feeds.monolitosSearch.url,
      [-840, -140],
    ),
    {
      parameters: { mode: 'append' },
      id: stableId('Unir Revista Central'),
      name: 'Unir Revista Central',
      type: 'n8n-nodes-base.merge',
      typeVersion: 3.2,
      position: [-580, -840],
    },
    {
      parameters: { mode: 'append' },
      id: stableId('Unir Monolitos Post'),
      name: 'Unir Monolitos Post',
      type: 'n8n-nodes-base.merge',
      typeVersion: 3.2,
      position: [-580, -280],
    },
    {
      parameters: { mode: 'append' },
      id: stableId('Unir todos os feeds'),
      name: 'Unir todos os feeds',
      type: 'n8n-nodes-base.merge',
      typeVersion: 3.2,
      position: [-340, -560],
    },
    {
      parameters: { jsCode: selectNewLinksCode },
      id: stableId('Selecionar links novos'),
      name: 'Selecionar links novos',
      type: 'n8n-nodes-base.code',
      typeVersion: 2,
      position: [-80, -560],
    },
    {
      parameters: {
        url: '={{ $json._canonicalLink }}',
        sendHeaders: true,
        headerParameters: {
          parameters: [
            {
              name: 'User-Agent',
              value: 'Mozilla/5.0 (compatible; n8n Quixada News Monitor/1.0)',
            },
          ],
        },
        options: {
          timeout: 20000,
          response: {
            response: {
              fullResponse: true,
              neverError: true,
              responseFormat: 'text',
              outputPropertyName: 'articleHtml',
            },
          },
        },
      },
      id: stableId('Baixar conteudo completo'),
      name: 'Baixar conteudo completo',
      type: 'n8n-nodes-base.httpRequest',
      typeVersion: 4.2,
      position: [180, -560],
      retryOnFail: true,
      maxTries: 3,
      waitBetweenTries: 2000,
      onError: 'continueRegularOutput',
    },
    {
      parameters: { jsCode: filterAndMessageCode },
      id: stableId('Filtrar e montar mensagem'),
      name: 'Filtrar e montar mensagem',
      type: 'n8n-nodes-base.code',
      typeVersion: 2,
      position: [440, -560],
    },
    {
      parameters: {
        resource: 'message',
        operation: 'sendMessage',
        chatId: '={{ $json.chatId }}',
        text: '={{ $json.message }}',
        additionalFields: {
          appendAttribution: false,
          parse_mode: 'HTML',
        },
      },
      id: stableId('Enviar notícia para Telegram'),
      name: 'Enviar notícia para Telegram',
      type: 'n8n-nodes-base.telegram',
      typeVersion: 1.2,
      position: [700, -560],
      retryOnFail: true,
      maxTries: 3,
      waitBetweenTries: 2000,
    },
    {
      parameters: {
        content:
          '## Configuração obrigatória\n\n1. No node **Filtrar e montar mensagem**, troque `SUBSTITUA_PELO_CHAT_ID`.\n2. No node **Enviar notícia para Telegram**, selecione a credencial do bot.\n3. Execute **Teste manual**: ele envia no máximo uma notícia recente.\n4. Salve e publique/ative o workflow.\n\nA primeira execução agendada apenas cria a linha de base e não envia notícias antigas.',
        height: 350,
        width: 520,
        color: 5,
      },
      id: stableId('Configurar antes de ativar'),
      name: 'Configurar antes de ativar',
      type: 'n8n-nodes-base.stickyNote',
      typeVersion: 1,
      position: [-1420, -1360],
    },
    {
      parameters: {
        content:
          '## Cobertura sem IA\n\n- Lê os feeds gerais e os feeds de busca por Quixadá.\n- Baixa o artigo completo somente para links novos.\n- Verifica título, RSS, corpo, categorias, URL e referências locais.\n- Em falha de leitura, envia como **Possível relação** para priorizar cobertura.\n- Deduplica por URL e reprocessa quando o conteúdo do RSS muda.\n- Conserva o histórico por 180 dias.',
        height: 350,
        width: 520,
        color: 4,
      },
      id: stableId('Como funciona'),
      name: 'Como funciona',
      type: 'n8n-nodes-base.stickyNote',
      typeVersion: 1,
      position: [40, -1120],
    },
  ],
  pinData: {},
  connections: {
    'Teste manual': {
      main: [[
        connection(feeds.revistaGeneral.node),
        connection(feeds.revistaSearch.node),
        connection(feeds.monolitosGeneral.node),
        connection(feeds.monolitosSearch.node),
      ]],
    },
    'A cada 5 minutos': {
      main: [[
        connection(feeds.revistaGeneral.node),
        connection(feeds.revistaSearch.node),
        connection(feeds.monolitosGeneral.node),
        connection(feeds.monolitosSearch.node),
      ]],
    },
    [feeds.revistaGeneral.node]: { main: [[connection(feeds.revistaGeneral.marker)]] },
    [feeds.revistaSearch.node]: { main: [[connection(feeds.revistaSearch.marker)]] },
    [feeds.monolitosGeneral.node]: { main: [[connection(feeds.monolitosGeneral.marker)]] },
    [feeds.monolitosSearch.node]: { main: [[connection(feeds.monolitosSearch.marker)]] },
    [feeds.revistaGeneral.marker]: { main: [[connection('Unir Revista Central', 0)]] },
    [feeds.revistaSearch.marker]: { main: [[connection('Unir Revista Central', 1)]] },
    [feeds.monolitosGeneral.marker]: { main: [[connection('Unir Monolitos Post', 0)]] },
    [feeds.monolitosSearch.marker]: { main: [[connection('Unir Monolitos Post', 1)]] },
    'Unir Revista Central': { main: [[connection('Unir todos os feeds', 0)]] },
    'Unir Monolitos Post': { main: [[connection('Unir todos os feeds', 1)]] },
    'Unir todos os feeds': { main: [[connection('Selecionar links novos')]] },
    'Selecionar links novos': { main: [[connection('Baixar conteudo completo')]] },
    'Baixar conteudo completo': { main: [[connection('Filtrar e montar mensagem')]] },
    'Filtrar e montar mensagem': { main: [[connection('Enviar notícia para Telegram')]] },
  },
  active: false,
  settings: {
    executionOrder: 'v1',
    timezone: 'America/Sao_Paulo',
  },
  versionId: stableId('workflow-version'),
  meta: { templateCredsSetupCompleted: false },
  tags: [],
};

const outputPath = path.join(
  repositoryRoot,
  'workflows',
  '03-noticias-quixada-telegram.json',
);

await writeFile(outputPath, `${JSON.stringify(workflow, null, 2)}\n`, 'utf8');
console.log(`Workflow gerado em ${outputPath}`);
