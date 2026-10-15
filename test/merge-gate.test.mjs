import { test } from 'node:test';
import assert from 'node:assert/strict';
import { caminhoOk, comandoMerge, confirmarMerge, decidirMerge } from '../src/merge-gate.mjs';

const SHA = 'a'.repeat(40);
const ALLOW = [/^docs\/BACKLOG\.md$/, /^docs\/relatorios\/2026-10-15-melhorias\.md$/];
const REPO = 'owner/repo';
const OPTS = { repo: REPO, pr: 12, autorEsperado: 'meu-bot', branchEsperada: 'bot/melhorias-2026-10-15', allowlist: ALLOW, merge: true };

const bom = (extra = {}) => ({
  repo: REPO,
  numero: 12,
  isCrossRepository: false,
  autor: 'meu-bot',
  estado: 'OPEN',
  headRefName: 'bot/melhorias-2026-10-15',
  baseRefName: 'main',
  isDraft: false,
  headShaAntes: SHA,
  headShaDepois: SHA,
  changedFiles: 2,
  arquivos: [
    { status: 'modified', caminho: 'docs/BACKLOG.md', anterior: '' },
    { status: 'added', caminho: 'docs/relatorios/2026-10-15-melhorias.md', anterior: '' },
  ],
  ciPassed: 'success',
  ...extra,
});

test('PR só de docs da allowlist, CI verde e um SHA: mescla', () => {
  const r = decidirMerge(bom(), OPTS);
  assert.equal(r.mesclar, true);
  assert.equal(r.sha, SHA);
});

test('merge é opt-in: sem merge: true o PR fica para o dono', () => {
  for (const merge of [false, undefined, 'true', 1]) {
    const r = decidirMerge(bom(), { ...OPTS, merge });
    assert.equal(r.mesclar, false, String(merge));
  }
});

test('renomeação conta pelos dois lados', () => {
  const insp = bom({
    arquivos: [
      { status: 'renamed', caminho: 'docs/BACKLOG.md', anterior: 'supabase/functions/x/index.ts' },
      { status: 'added', caminho: 'docs/relatorios/2026-10-15-melhorias.md', anterior: '' },
    ],
  });
  const r = decidirMerge(insp, OPTS);
  assert.equal(r.mesclar, false);
  assert.match(r.motivo, /fora da allowlist: supabase\/functions\/x\/index\.ts -> docs\/BACKLOG\.md/);
});

test('arquivo fora da allowlist, relatório antigo e ".." reprovam', () => {
  for (const caminho of ['app/auth.ts', 'docs/relatorios/2026-01-01-antigo.md', 'docs/../.github/workflows/ci.yml']) {
    const r = decidirMerge(bom({ arquivos: [{ status: 'modified', caminho, anterior: '' }], changedFiles: 1 }), OPTS);
    assert.equal(r.mesclar, false, caminho);
  }
  assert.equal(caminhoOk({ caminho: '' }, ALLOW), false);
});

test('push no meio da inspeção (SHA antes != depois) ou SHA inválido reprova', () => {
  assert.equal(decidirMerge(bom({ headShaDepois: 'b'.repeat(40) }), OPTS).mesclar, false);
  for (const sha of ['', 'HEAD', 'abc123', 'A'.repeat(40)]) {
    assert.equal(decidirMerge(bom({ headShaAntes: sha, headShaDepois: sha }), OPTS).mesclar, false, sha);
  }
});

test('lista de arquivos truncada (paginação) reprova', () => {
  const r = decidirMerge(bom({ changedFiles: 31 }), OPTS);
  assert.equal(r.mesclar, false);
  assert.match(r.motivo, /incompleta \(2 de 31\)/);
});

test('PR sem arquivos reprova', () => {
  assert.equal(decidirMerge(bom({ arquivos: [], changedFiles: 0 }), OPTS).mesclar, false);
});

test('CI diferente de success reprova', () => {
  for (const ci of ['pending', 'failure', 'ausente', undefined]) {
    assert.equal(decidirMerge(bom({ ciPassed: ci }), OPTS).mesclar, false, String(ci));
  }
});

test('draft, base errada e estado fechado reprovam', () => {
  assert.equal(decidirMerge(bom({ isDraft: true }), OPTS).mesclar, false);
  assert.equal(decidirMerge(bom({ baseRefName: 'release' }), OPTS).mesclar, false);
  assert.equal(decidirMerge(bom({ estado: 'CLOSED' }), OPTS).mesclar, false);
});

test('número de PR de outra branch não é tratado como o PR do fluxo', () => {
  const r = decidirMerge(bom({ headRefName: 'feature/outro', estado: 'MERGED' }), OPTS);
  assert.equal(r.mesclar, false);
  assert.equal(r.alerta, false);
  assert.match(r.motivo, /outra branch/);
});

test('PR do fluxo já mesclado por fora gera alerta, não merge', () => {
  const r = decidirMerge(bom({ estado: 'MERGED' }), OPTS);
  assert.equal(r.mesclar, false);
  assert.equal(r.alerta, true);
});

test('inspeção nula reprova', () => {
  assert.equal(decidirMerge(null, OPTS).mesclar, false);
});

test('comando de merge amarra o SHA e recusa entradas malformadas', () => {
  assert.equal(
    comandoMerge('owner/repo', 12, SHA),
    `gh pr merge 12 --repo owner/repo --squash --match-head-commit ${SHA}`,
  );
  assert.throws(() => comandoMerge('owner/repo', 0, SHA));
  assert.throws(() => comandoMerge('owner/repo', 12, 'HEAD'));
  assert.throws(() => comandoMerge('owner/repo; rm -rf /', 12, SHA));
});

test('pós-merge: head diferente do inspecionado é alerta', () => {
  assert.deepEqual(confirmarMerge({ estado: 'MERGED', headRefOid: SHA }, SHA), {
    mesclado: true,
    alerta: false,
    motivo: '',
  });
  assert.equal(confirmarMerge({ estado: 'MERGED', headRefOid: 'b'.repeat(40) }, SHA).alerta, true);
  assert.equal(confirmarMerge({ estado: 'OPEN', headRefOid: SHA }, SHA).mesclado, false);
});

test('identidade: fork com a mesma branch, outro repo, outro número e outro autor reprovam', () => {
  assert.equal(decidirMerge(bom({ isCrossRepository: true }), OPTS).mesclar, false);
  assert.equal(decidirMerge(bom({ isCrossRepository: undefined }), OPTS).mesclar, false);
  assert.equal(decidirMerge(bom({ repo: 'atacante/repo' }), OPTS).mesclar, false);
  assert.equal(decidirMerge(bom({ numero: 13 }), OPTS).mesclar, false);
  assert.equal(decidirMerge(bom({ autor: 'atacante' }), OPTS).mesclar, false);
});

test('configuração incompleta do portão nunca mescla', () => {
  for (const falta of ['repo', 'autorEsperado']) {
    assert.equal(decidirMerge(bom(), { ...OPTS, [falta]: '' }).mesclar, false, falta);
  }
  assert.equal(decidirMerge(bom(), { ...OPTS, pr: 0 }).mesclar, false);
});
