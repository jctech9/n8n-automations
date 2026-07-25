const CONFIG = {
  telegramChatId: 'SUBSTITUA_PELO_CHAT_ID',
  manualMaxMessages: 1,
  summaryMaxCharacters: 1400,
  localReferences: [
    'açude cedro',
    'açude do cedro',
    'pedra da galinha choca',
    'serra do estevão',
    'parque de exposições valdir do couto dinelly',
    'valdir do couto dinelly',
    'praça josé de barros',
    'estádio abilhão',
    'unicatólica',
    'centro universitário católica de quixadá',
    'feclesc',
    'canarinho do sertão',
    'quixadá futebol clube',
    'expocece',
    'juatama',
    'tapuiará',
    'cipó dos anjos',
    'dom maurício',
    'são joão dos queiroz',
  ],
};

const inputItems = $input.all();
const originalItems = $('Selecionar links novos').all();
const state = $getWorkflowStaticData('global');
state.processedLinks =
  state.processedLinks && typeof state.processedLinks === 'object'
    ? state.processedLinks
    : {};

const executionMode = String($execution?.mode || 'manual');
const now = Date.now();

const namedEntities = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  aacute: 'á',
  agrave: 'à',
  acirc: 'â',
  atilde: 'ã',
  eacute: 'é',
  ecirc: 'ê',
  iacute: 'í',
  oacute: 'ó',
  ocirc: 'ô',
  otilde: 'õ',
  uacute: 'ú',
  ccedil: 'ç',
};

const decodeEntities = (value) =>
  String(value || '').replace(
    /&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi,
    (match, entity) => {
      const lowered = entity.toLowerCase();
      if (lowered.startsWith('#x')) {
        const code = Number.parseInt(lowered.slice(2), 16);
        return Number.isFinite(code) ? String.fromCodePoint(code) : match;
      }
      if (lowered.startsWith('#')) {
        const code = Number.parseInt(lowered.slice(1), 10);
        return Number.isFinite(code) ? String.fromCodePoint(code) : match;
      }
      return namedEntities[lowered] ?? match;
    },
  );

const stripHtml = (value) =>
  decodeEntities(
    String(value || '')
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
      .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, ' ')
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<[^>]+>/g, ' '),
  )
    .replace(/\s+/g, ' ')
    .trim();

const normalize = (value) =>
  stripHtml(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();

const escapeHtml = (value) =>
  String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');

const hasClasses = (openingTag, requiredClasses) => {
  const match = openingTag.match(/\bclass\s*=\s*["']([^"']+)["']/i);
  if (!match) return false;
  const classes = new Set(match[1].split(/\s+/).filter(Boolean));
  return requiredClasses.every((name) => classes.has(name));
};

const extractDivByClasses = (html, requiredClasses) => {
  const source = String(html || '');
  const openingPattern = /<div\b[^>]*>/gi;
  let opening;

  while ((opening = openingPattern.exec(source))) {
    if (!hasClasses(opening[0], requiredClasses)) continue;
    const contentStart = openingPattern.lastIndex;
    const divPattern = /<\/?div\b[^>]*>/gi;
    divPattern.lastIndex = contentStart;
    let depth = 1;
    let tag;

    while ((tag = divPattern.exec(source))) {
      depth += /^<div\b/i.test(tag[0]) ? 1 : -1;
      if (depth === 0) return source.slice(contentStart, tag.index);
    }
  }
  return '';
};

const extractArticleBody = (html, sources) => {
  const sourceName = normalize(sources.join(' '));
  if (sourceName.includes('revista central')) {
    return extractDivByClasses(html, ['post_content', 'jl_content']);
  }
  if (sourceName.includes('monolitos post')) {
    return extractDivByClasses(html, ['post']);
  }
  return '';
};

const directPattern = /\bquixada(?:ense|enses)?\b/;
const normalizedReferences = CONFIG.localReferences.map(normalize);
const dateFormatter = new Intl.DateTimeFormat('pt-BR', {
  timeZone: 'America/Sao_Paulo',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

const relevantItems = [];

for (let index = 0; index < inputItems.length; index++) {
  const response = inputItems[index]?.json || {};
  const original = originalItems[index]?.json || {};
  const sources = Array.isArray(original._sources)
    ? original._sources
    : [String(original._source || 'Fonte não identificada')];
  const feedModes = Array.isArray(original._feedModes)
    ? original._feedModes
    : [String(original._feedMode || 'general')];

  const statusCode = Number(response.statusCode || 0);
  const downloadedHtml = String(response.articleHtml || '');
  const fetchFailed =
    Boolean(response.error) ||
    !downloadedHtml ||
    (statusCode > 0 && (statusCode < 200 || statusCode >= 400));
  const extractedHtml = extractArticleBody(downloadedHtml, sources);
  const selectorFailed = !fetchFailed && !extractedHtml;

  const title = stripHtml(original.title || 'Sem título');
  const rssContent = [
    original.contentSnippet,
    original.content,
    original['content:encoded'],
    original.description,
    JSON.stringify(original.categories || original.category || []),
  ]
    .filter(Boolean)
    .join(' ');
  const articleText = stripHtml(extractedHtml);
  const searchable = normalize(
    [title, rssContent, articleText, original._canonicalLink].join(' '),
  );

  const directMention = directPattern.test(searchable);
  const localReference = normalizedReferences.find((term) =>
    searchable.includes(term),
  );
  const cameFromSearch = feedModes.includes('search');

  let relevant = false;
  let matchReason = '';
  let confidenceLabel = 'Confirmada';

  if (directMention) {
    relevant = true;
    matchReason = 'menção direta a Quixadá';
  } else if (localReference) {
    relevant = true;
    matchReason = `referência local: ${localReference}`;
  } else if (cameFromSearch) {
    relevant = true;
    matchReason = 'resultado da busca por Quixadá no próprio site';
  } else if (fetchFailed || selectorFailed) {
    relevant = true;
    confidenceLabel = 'Possível relação';
    matchReason = fetchFailed
      ? 'artigo indisponível para validação'
      : 'estrutura do artigo não reconhecida';
  }

  if (executionMode !== 'manual' && original._canonicalLink) {
    state.processedLinks[original._canonicalLink] = {
      at: now,
      fingerprint: original._fingerprint,
      relevant,
      reason: matchReason || 'sem relação identificada',
    };
  }

  if (!relevant) continue;

  const summarySource =
    original.contentSnippet ||
    original.description ||
    articleText ||
    'Resumo não disponível.';
  let summary = stripHtml(summarySource);
  if (summary.length > CONFIG.summaryMaxCharacters) {
    summary = `${summary.slice(0, CONFIG.summaryMaxCharacters - 1).trimEnd()}…`;
  }

  const publishedAt = Number(original._publicationTime || 0);
  const publishedText = publishedAt
    ? dateFormatter.format(new Date(publishedAt))
    : 'data não informada';
  const link = String(original._canonicalLink || original.link || '');
  const sourceText = sources.join(', ');

  const message = [
    '📰 <b>NOTÍCIA SOBRE QUIXADÁ</b>',
    '',
    `<b>Classificação:</b> ${escapeHtml(confidenceLabel)}`,
    `<b>Fonte:</b> ${escapeHtml(sourceText)}`,
    `<b>Publicada:</b> ${escapeHtml(publishedText)}`,
    '',
    `<b>${escapeHtml(title)}</b>`,
    '',
    escapeHtml(summary),
    '',
    `<i>Motivo do filtro: ${escapeHtml(matchReason)}</i>`,
    `<a href="${escapeHtml(link)}">Abrir notícia</a>`,
  ].join('\n');

  relevantItems.push({
    json: {
      chatId: CONFIG.telegramChatId,
      message,
      link,
      title,
      source: sourceText,
      classification: confidenceLabel,
      matchReason,
      publishedAt,
    },
  });
}

relevantItems.sort(
  (a, b) => Number(b.json.publishedAt || 0) - Number(a.json.publishedAt || 0),
);

return executionMode === 'manual'
  ? relevantItems.slice(0, CONFIG.manualMaxMessages)
  : relevantItems;
