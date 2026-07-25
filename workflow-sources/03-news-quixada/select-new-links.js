const CONFIG = {
  retentionDays: 180,
  maxHistory: 10000,
  manualMaxLinks: 1,
};

const state = $getWorkflowStaticData('global');
state.processedLinks =
  state.processedLinks && typeof state.processedLinks === 'object'
    ? state.processedLinks
    : {};

const now = Date.now();
const executionMode = String($execution?.mode || 'manual');

const canonicalize = (value) => {
  try {
    const url = new URL(String(value || '').trim());
    if (!['http:', 'https:'].includes(url.protocol)) return '';
    for (const key of [...url.searchParams.keys()]) {
      if (
        key.toLowerCase().startsWith('utm_') ||
        ['fbclid', 'gclid', 'ref', 'source'].includes(key.toLowerCase())
      ) {
        url.searchParams.delete(key);
      }
    }
    url.hash = '';
    url.pathname = url.pathname.replace(/\/+$/, '') || '/';
    return url.toString();
  } catch (_) {
    return '';
  }
};

const hash = (value) => {
  let result = 2166136261;
  for (const char of String(value || '')) {
    result ^= char.charCodeAt(0);
    result = Math.imul(result, 16777619);
  }
  return (result >>> 0).toString(16).padStart(8, '0');
};

const publicationTime = (item) => {
  const parsed = Date.parse(item.isoDate || item.pubDate || item.date || '');
  return Number.isFinite(parsed) ? parsed : 0;
};

const candidates = new Map();

for (const input of $input.all()) {
  const item = input.json || {};
  const canonicalLink = canonicalize(item.link || item.guid);
  if (!canonicalLink) continue;

  const fingerprint = hash(
    [
      item.title || '',
      item.isoDate || item.pubDate || '',
      item.contentSnippet || item.description || '',
    ].join('|'),
  );

  const existing = candidates.get(canonicalLink);
  if (!existing) {
    candidates.set(canonicalLink, {
      ...item,
      _canonicalLink: canonicalLink,
      _fingerprint: fingerprint,
      _sources: [String(item._source || 'Fonte não identificada')],
      _feedModes: [String(item._feedMode || 'general')],
      _publicationTime: publicationTime(item),
    });
    continue;
  }

  existing._sources = [
    ...new Set([...existing._sources, String(item._source || 'Fonte não identificada')]),
  ];
  existing._feedModes = [
    ...new Set([...existing._feedModes, String(item._feedMode || 'general')]),
  ];

  const existingText = String(existing.content || existing['content:encoded'] || '');
  const candidateText = String(item.content || item['content:encoded'] || '');
  if (candidateText.length > existingText.length) {
    const preserved = {
      _canonicalLink: existing._canonicalLink,
      _fingerprint: existing._fingerprint,
      _sources: existing._sources,
      _feedModes: existing._feedModes,
      _publicationTime: Math.max(existing._publicationTime, publicationTime(item)),
    };
    Object.assign(existing, item, preserved);
  }
}

const ordered = [...candidates.values()].sort(
  (a, b) => b._publicationTime - a._publicationTime,
);

const retentionCutoff = now - CONFIG.retentionDays * 86400000;
for (const [link, record] of Object.entries(state.processedLinks)) {
  if (!record || Number(record.at || 0) < retentionCutoff) {
    delete state.processedLinks[link];
  }
}

const historyEntries = Object.entries(state.processedLinks);
if (historyEntries.length > CONFIG.maxHistory) {
  historyEntries
    .sort((a, b) => Number(a[1]?.at || 0) - Number(b[1]?.at || 0))
    .slice(0, historyEntries.length - CONFIG.maxHistory)
    .forEach(([link]) => delete state.processedLinks[link]);
}

// A primeira execução agendada cria uma linha de base para não disparar
// dezenas de notícias antigas logo após a ativação.
if (executionMode !== 'manual' && !state.newsMonitorInitializedAt) {
  for (const item of ordered) {
    state.processedLinks[item._canonicalLink] = {
      at: now,
      fingerprint: item._fingerprint,
      baseline: true,
    };
  }
  state.newsMonitorInitializedAt = now;
  return [];
}

const manualCandidates = [
  ...ordered.filter((item) => item._feedModes.includes('search')),
  ...ordered.filter((item) => !item._feedModes.includes('search')),
];
const output =
  executionMode === 'manual'
    ? manualCandidates.slice(0, CONFIG.manualMaxLinks)
    : ordered.filter((item) => {
        const previous = state.processedLinks[item._canonicalLink];
        return !previous || previous.fingerprint !== item._fingerprint;
      });

return output.map((item) => ({ json: item }));
