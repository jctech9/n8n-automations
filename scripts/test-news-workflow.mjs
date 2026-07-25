import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, '..');
const sourceDirectory = path.join(repositoryRoot, 'workflow-sources', '03-news-quixada');

const [selectCode, filterCode] = await Promise.all([
  readFile(path.join(sourceDirectory, 'select-new-links.js'), 'utf8'),
  readFile(path.join(sourceDirectory, 'filter-and-message.js'), 'utf8'),
]);

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

const runSelect = async (items, mode, state) => {
  const execute = new AsyncFunction(
    '$input',
    '$execution',
    '$getWorkflowStaticData',
    selectCode,
  );
  return execute(
    { all: () => items.map((json) => ({ json })) },
    { mode },
    () => state,
  );
};

const runFilter = async (originals, responses, mode, state) => {
  const execute = new AsyncFunction(
    '$input',
    '$execution',
    '$getWorkflowStaticData',
    '$',
    filterCode,
  );
  return execute(
    { all: () => responses.map((json) => ({ json })) },
    { mode },
    () => state,
    (nodeName) => {
      assert.equal(nodeName, 'Selecionar links novos');
      return { all: () => originals.map((json) => ({ json })) };
    },
  );
};

const baseItems = [
  {
    title: 'Operação acontece em Quixadá',
    link: 'https://example.com/noticia/?utm_source=test',
    isoDate: '2026-07-25T12:00:00.000Z',
    contentSnippet: 'Notícia local.',
    _source: 'Revista Central',
    _feedMode: 'general',
  },
  {
    title: 'Operação acontece em Quixadá',
    link: 'https://example.com/noticia/',
    isoDate: '2026-07-25T12:00:00.000Z',
    contentSnippet: 'Notícia local.',
    _source: 'Revista Central',
    _feedMode: 'search',
  },
];

{
  const state = {};
  const output = await runSelect(baseItems, 'manual', state);
  assert.equal(output.length, 1, 'deve deduplicar URLs equivalentes');
  assert.deepEqual(output[0].json._feedModes.sort(), ['general', 'search']);
}

{
  const state = {};
  const output = await runSelect(
    [
      {
        ...baseItems[0],
        title: 'Mais recente, mas apenas no feed geral',
        link: 'https://example.com/mais-recente',
        isoDate: '2026-07-25T13:00:00.000Z',
      },
      baseItems[1],
    ],
    'manual',
    state,
  );
  assert.equal(output.length, 1, 'o teste manual deve baixar somente um artigo');
  assert.ok(
    output[0].json._feedModes.includes('search'),
    'o teste manual deve priorizar um resultado já selecionado pela busca do site',
  );
}

{
  const state = {};
  const output = await runSelect(baseItems, 'trigger', state);
  assert.equal(output.length, 0, 'a primeira agenda deve apenas criar a linha de base');
  assert.ok(state.newsMonitorInitializedAt);
  assert.equal(Object.keys(state.processedLinks).length, 1);
}

{
  const state = { newsMonitorInitializedAt: Date.now(), processedLinks: {} };
  const selected = await runSelect([baseItems[0]], 'trigger', state);
  assert.equal(selected.length, 1, 'um link novo deve seguir para análise');

  const filtered = await runFilter(
    selected.map((item) => item.json),
    [{
      statusCode: 200,
      articleHtml:
        '<div class="post_content jl_content"><p>A ação aconteceu em Quixadá.</p></div>',
    }],
    'trigger',
    state,
  );
  assert.equal(filtered.length, 1, 'menção direta deve ser enviada');
  assert.match(filtered[0].json.message, /menção direta a Quixadá/);
  assert.equal(state.processedLinks[selected[0].json._canonicalLink].relevant, true);
}

{
  const original = {
    ...baseItems[0],
    title: 'Notícia completamente nacional',
    contentSnippet: 'Sem relação com a cidade monitorada.',
    _canonicalLink: 'https://example.com/nacional',
    _fingerprint: 'abc',
    _sources: ['Revista Central'],
    _feedModes: ['general'],
    _publicationTime: Date.now(),
  };
  const result = await runFilter(
    [original],
    [{
      statusCode: 200,
      articleHtml:
        '<div class="post_content jl_content"><p>O fato ocorreu em Minas Gerais.</p></div>',
    }],
    'trigger',
    { processedLinks: {} },
  );
  assert.equal(result.length, 0, 'matéria sem sinal local deve ser descartada');
}

{
  const original = {
    ...baseItems[0],
    title: 'Expocece anuncia atrações',
    contentSnippet: 'Evento no Parque de Exposições Valdir do Couto Dinelly.',
    _canonicalLink: 'https://example.com/expocece',
    _fingerprint: 'def',
    _sources: ['Monolitos Post'],
    _feedModes: ['general'],
    _publicationTime: Date.now(),
  };
  const result = await runFilter(
    [original],
    [{
      statusCode: 200,
      articleHtml: '<div class="post"><p>Programação gratuita para o público.</p></div>',
    }],
    'trigger',
    { processedLinks: {} },
  );
  assert.equal(result.length, 1, 'referência local forte deve ser enviada');
  assert.match(result[0].json.matchReason, /referência local/);
}

{
  const original = {
    ...baseItems[0],
    title: 'Título sem a palavra monitorada',
    contentSnippet: 'Resumo curto.',
    _canonicalLink: 'https://example.com/busca',
    _fingerprint: 'ghi',
    _sources: ['Monolitos Post'],
    _feedModes: ['search'],
    _publicationTime: Date.now(),
  };
  const result = await runFilter(
    [original],
    [{ statusCode: 200, articleHtml: '<div class="post"><p>Texto.</p></div>' }],
    'trigger',
    { processedLinks: {} },
  );
  assert.equal(result.length, 1, 'resultado da busca do site deve ser enviado');
}

{
  const original = {
    ...baseItems[0],
    title: 'Artigo que não pôde ser lido',
    contentSnippet: '',
    _canonicalLink: 'https://example.com/falha',
    _fingerprint: 'jkl',
    _sources: ['Revista Central'],
    _feedModes: ['general'],
    _publicationTime: Date.now(),
  };
  const result = await runFilter(
    [original],
    [{ error: 'timeout' }],
    'trigger',
    { processedLinks: {} },
  );
  assert.equal(result.length, 1, 'falha de leitura deve favorecer cobertura');
  assert.equal(result[0].json.classification, 'Possível relação');
}

console.log('Testes do workflow de notícias passaram.');
