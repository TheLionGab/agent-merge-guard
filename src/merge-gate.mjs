// Portão de merge para PRs abertos por agentes.
//
// Princípio: o agente só LÊ (gh pr view, API de Actions, lista de arquivos) e devolve fatos
// literais. Quem decide é esta função pura, sem rede e sem modelo. O merge só acontece se
// todas as condições valem ao mesmo tempo e é feito com --match-head-commit no SHA inspecionado.

const SHA = /^[0-9a-f]{40}$/;

/**
 * Renomeação conta pelos dois lados: tirar um arquivo de fora da allowlist também é mudá-lo.
 * `..` em qualquer lado reprova.
 * @param {{caminho: string, anterior?: string}} arquivo
 * @param {RegExp[]} allowlist
 */
export function caminhoOk(arquivo, allowlist) {
  const lados = [arquivo.caminho, arquivo.anterior].filter(Boolean);
  if (!arquivo.caminho || lados.some((p) => p.includes('..'))) return false;
  return lados.every((p) => allowlist.some((re) => re.test(p)));
}

/**
 * @typedef {object} Inspecao
 * @property {string} estado OPEN | MERGED | CLOSED
 * @property {string} repo repo base do PR (nameWithOwner), lido da API
 * @property {number} numero número do PR, lido da API
 * @property {boolean} isCrossRepository true se o head vem de um fork
 * @property {string} autor login de quem abriu o PR
 * @property {string} headRefName
 * @property {string} baseRefName
 * @property {boolean} isDraft
 * @property {string} headShaAntes SHA lido antes do CI e da lista de arquivos
 * @property {string} headShaDepois SHA lido depois: precisa ser igual (TOCTOU)
 * @property {number} changedFiles total de arquivos informado pelo PR
 * @property {{status: string, caminho: string, anterior?: string}[]} arquivos lista paginada
 * @property {'success'|'pending'|'failure'|'ausente'} ciPassed
 */

/**
 * @param {Inspecao | null} insp
 * @param {{ repo: string, pr: number, autorEsperado: string, branchEsperada: string, allowlist: RegExp[], merge: boolean }} opts
 * @returns {{ mesclar: boolean, alerta: boolean, motivo: string, sha?: string }}
 */
export function decidirMerge(insp, { repo, pr, autorEsperado, branchEsperada, allowlist, merge }) {
  const nao = (motivo) => ({ mesclar: false, alerta: false, motivo });
  if (!insp) return nao('inspeção falhou');
  // O número do PR veio de um agente: confere que é o PR que este fluxo abriu. Nome de branch
  // sozinho não prova nada (um fork pode ter a mesma), então repo, número, origem e autor também.
  if (!repo || !autorEsperado || !Number.isInteger(pr) || pr <= 0)
    return nao('configuração do portão incompleta (repo, pr, autorEsperado)');
  if (insp.repo !== repo || insp.numero !== pr)
    return nao(`inspeção de outro PR (${insp.repo}#${insp.numero})`);
  if (insp.isCrossRepository !== false) return nao('head vem de fork (ou origem não informada)');
  if (insp.autor !== autorEsperado) return nao(`autor ${insp.autor}, esperado ${autorEsperado}`);
  if (insp.headRefName !== branchEsperada) return nao(`PR de outra branch (${insp.headRefName})`);
  if (insp.estado === 'MERGED')
    return { mesclar: false, alerta: true, motivo: 'ALERTA: mesclado fora do portão, revisar o diff' };
  if (insp.estado !== 'OPEN') return nao(`PR ${insp.estado}`);
  // Merge é opt-in: sem ele o PR fica pronto para um humano.
  if (merge !== true) return nao('merge: false (PR pronto para o dono)');
  if (insp.baseRefName !== 'main') return nao(`base ${insp.baseRefName}, não main`);
  if (insp.isDraft) return nao('PR em draft');
  // CI e arquivos valem para um SHA só: push no meio da inspeção invalida tudo.
  if (!SHA.test(insp.headShaAntes) || insp.headShaAntes !== insp.headShaDepois)
    return nao('head mudou durante a inspeção (ou SHA inválido)');
  if (!insp.arquivos.length) return nao('PR sem arquivos');
  if (insp.arquivos.length !== insp.changedFiles)
    return nao(`lista de arquivos incompleta (${insp.arquivos.length} de ${insp.changedFiles})`);
  const fora = insp.arquivos
    .filter((a) => !caminhoOk(a, allowlist))
    .map((a) => (a.anterior ? `${a.anterior} -> ${a.caminho}` : a.caminho));
  if (fora.length) return nao(`arquivos fora da allowlist: ${fora.join(', ')}`);
  if (insp.ciPassed !== 'success') return nao(`CI passed = ${insp.ciPassed}`);
  return { mesclar: true, alerta: false, motivo: '', sha: insp.headShaAntes };
}

/** Comando de merge amarrado ao SHA inspecionado: se o head mudou, o gh recusa. */
export function comandoMerge(repo, pr, sha) {
  if (!Number.isInteger(pr) || pr <= 0) throw new Error('pr inválido');
  if (!SHA.test(sha)) throw new Error('sha inválido');
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new Error('repo inválido');
  return `gh pr merge ${pr} --repo ${repo} --squash --match-head-commit ${sha}`;
}

/**
 * Pós-merge: depois do merge o estado do PR decide, não o texto do agente.
 * Mesclado com head diferente do inspecionado = merge sem --match-head-commit.
 */
export function confirmarMerge(estadoPosMerge, shaInspecionado) {
  if (estadoPosMerge.estado !== 'MERGED') return { mesclado: false, alerta: false };
  if (estadoPosMerge.headRefOid !== shaInspecionado)
    return { mesclado: true, alerta: true, motivo: 'ALERTA: mesclado com head diferente do inspecionado' };
  return { mesclado: true, alerta: false, motivo: '' };
}
