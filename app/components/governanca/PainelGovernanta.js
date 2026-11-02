'use client';

// ============================================================================
// GOVERNANÇA → aba PAINEL (governanta / recepção: ADMIN e COLABORADOR)
// - Números de hoje
// - Escala de hoje: quem veio e em que andar(es) fica (vem preenchida igual ao
//   último dia salvo) → "Distribuir quartos" mostra a prévia → "Confirmar"
//   grava a camareira de cada quarto e avisa a Cloudbeds (se a ligação das
//   camareiras estiver feita em Configurações)
// - Vistoria (opcional): quartos limpos hoje ainda não vistoriados; aprovar
//   manda "Inspecionado" para a Cloudbeds; reprovar devolve o quarto para a
//   mesma camareira, no topo da lista, com o que precisa refazer
// - Pedidos especiais (toalha extra...) com aviso no celular da camareira
//   (PedidosRecepcao.js)
// - Estoque e enxoval no mínimo
// Regras em lib/governanca/distribuicao.js e lib/estoqueAlertas.js.
// ============================================================================

import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../../../lib/supabaseClient';
import { buscarTodos } from '../../../lib/buscarTodos';
import { precisaArrumar, diaNoHotel, hojeNoHotel, rotuloDoEstado, formatarDia } from '../../../lib/governanca/regras';
import {
  andarDoQuarto, nomeDoAndar, andaresDosQuartos, escalaSugerida, distribuir,
  ITENS_VISTORIA, resultadoDaVistoria, textoRefazer, paraVistoriar,
} from '../../../lib/governanca/distribuicao';
import { alertasDeEstoque, textoDoAlerta } from '../../../lib/estoqueAlertas';
import PedidosRecepcao from './PedidosRecepcao';

function hora(valor) {
  if (!valor) return '';
  try { return new Date(valor).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Fortaleza' }); }
  catch (e) { return ''; }
}

async function chamarRota(caminho, corpo) {
  const { data: sessao } = await supabase.auth.getSession();
  const resposta = await fetch(caminho, {
    method: corpo ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sessao.session.access_token}` },
    ...(corpo ? { body: JSON.stringify(corpo) } : {}),
  });
  const r = await resposta.json().catch(() => ({}));
  return { ok: resposta.ok && !r.erro, ...r };
}

export default function PainelGovernanta({ usuario, quartos, sessoes, camareiras, recarregar, mostrarAviso, mostrarSync }) {
  const hoje = hojeNoHotel();
  const [escala, setEscala] = useState([]);
  const [infoEscala, setInfoEscala] = useState({ salvaHoje: false, copiadaDe: null });
  const [vistoriasHoje, setVistoriasHoje] = useState([]);
  const [estoque, setEstoque] = useState({ produtos: [], saldos: [], depositos: [] });
  const [previa, setPrevia] = useState(null);
  const [ocupado, setOcupado] = useState('');
  const [erro, setErro] = useState('');
  const [vistoria, setVistoria] = useState(null); // { quarto, sessao, marcados, observacao }

  // Recarrega só quando a lista de camareiras muda de verdade (não a cada
  // atualização da tela), para não apagar a escala que está sendo marcada
  const chaveCamareiras = camareiras.map((c) => `${c.id}:${c.nome}`).join('|');
  const carregar = useCallback(async () => {
    const desde = new Date(Date.now() - 21 * 86400000).toLocaleDateString('en-CA', { timeZone: 'America/Fortaleza' });
    const { data: registros } = await supabase.from('governanca_escala').select('*')
      .eq('hotel_id', usuario.hotel_id).gte('data', desde).order('data', { ascending: false });
    const sugestao = escalaSugerida(camareiras, registros || [], hojeNoHotel());
    setEscala(sugestao.linhas);
    setInfoEscala({ salvaHoje: sugestao.salvaHoje, copiadaDe: sugestao.copiadaDe });

    const inicioHoje = new Date(`${hojeNoHotel()}T00:00:00-03:00`).toISOString();
    const { data: vs } = await supabase.from('governanca_vistorias').select('*')
      .eq('hotel_id', usuario.hotel_id).gte('criado_em', inicioHoje).order('criado_em', { ascending: false });
    setVistoriasHoje(vs || []);

    const [{ data: produtos }, { data: saldos }, { data: depositos }] = await Promise.all([
      buscarTodos(() => supabase.from('estoque_produtos').select('*').eq('hotel_id', usuario.hotel_id)),
      buscarTodos(() => supabase.from('estoque_saldos').select('*').eq('hotel_id', usuario.hotel_id)),
      supabase.from('estoque_depositos').select('*').eq('hotel_id', usuario.hotel_id),
    ]);
    setEstoque({ produtos: produtos || [], saldos: saldos || [], depositos: depositos || [] });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [usuario.hotel_id, chaveCamareiras]);

  useEffect(() => { carregar(); }, [carregar]);

  const andares = andaresDosQuartos(quartos);
  const paraArrumar = quartos.filter(precisaArrumar).length;
  const emArrumacao = quartos.filter((q) => q.status === 'EM_ARRUMACAO').length;
  const limposHoje = sessoes.filter((s) => s.fim_em && !s.cancelada && diaNoHotel(s.fim_em) === hoje).length;
  const filaVistoria = paraVistoriar(quartos, sessoes, vistoriasHoje, hoje, diaNoHotel);
  const manutencao = quartos.filter((q) => q.status === 'MANUTENCAO').length;
  const alertas = alertasDeEstoque(estoque.produtos, estoque.saldos, estoque.depositos);
  const aprovadasHoje = vistoriasHoje.filter((v) => v.resultado === 'APROVADO').length;
  const reprovadasHoje = vistoriasHoje.filter((v) => v.resultado === 'REPROVADO').length;
  const nomeCamareira = (id) => camareiras.find((c) => Number(c.id) === Number(id))?.nome || '—';

  // ---- Escala -----------------------------------------------------------------
  function trocarLinha(id, campos) {
    setPrevia(null);
    setEscala((lista) => lista.map((l) => (l.camareira_id === id ? { ...l, ...campos } : l)));
  }
  function alternarAndar(linha, andar) {
    const tem = linha.andares.includes(andar);
    trocarLinha(linha.camareira_id, { andares: tem ? linha.andares.filter((a) => a !== andar) : [...linha.andares, andar].sort((a, b) => a - b) });
  }

  async function salvarEscala(silencioso = false) {
    setErro('');
    const linhas = escala.map((l) => ({
      hotel_id: usuario.hotel_id, data: hoje, camareira_id: l.camareira_id, camareira_nome: l.camareira_nome,
      presente: l.presente, andares: l.andares, atualizado_por_id: usuario.id, atualizado_em: new Date().toISOString(),
    }));
    if (!linhas.length) return true;
    const { error } = await supabase.from('governanca_escala').upsert(linhas, { onConflict: 'hotel_id,data,camareira_id' });
    if (error) { setErro('Não foi possível salvar a escala. Detalhe técnico: ' + error.message); return false; }
    setInfoEscala({ salvaHoje: true, copiadaDe: null });
    if (!silencioso) mostrarAviso('Escala de hoje salva!');
    return true;
  }

  async function verDistribuicao() {
    setOcupado('previa');
    const salvou = await salvarEscala(true);
    setOcupado('');
    if (!salvou) return;
    const r = distribuir(quartos, escala);
    if (r.erro) { setErro(r.erro); setPrevia(null); return; }
    setErro('');
    setPrevia(r);
  }

  async function confirmarDistribuicao() {
    if (!previa) return;
    setOcupado('confirmar');
    setErro('');
    // Grava por camareira; quem já entrou num quarto não perde o quarto
    for (const g of previa.porCamareira) {
      const ids = g.quartos.filter((q) => Number(q.camareira_id) !== Number(g.camareira_id)).map((q) => q.id);
      if (!ids.length) continue;
      const { error } = await supabase.from('quartos').update({ camareira_id: g.camareira_id })
        .in('id', ids).neq('status', 'EM_ARRUMACAO');
      if (error) { setOcupado(''); setErro('Não foi possível gravar a distribuição. Detalhe técnico: ' + error.message); return; }
    }
    const total = previa.total;
    const atribuicoes = previa.porCamareira.map((g) => ({ camareiraId: g.camareira_id, quartoIds: g.quartos.map((q) => q.id) }));
    setPrevia(null);
    setOcupado('');
    mostrarAviso(`✅ ${total} quarto(s) distribuído(s). As camareiras já veem a lista nova.`);
    recarregar();
    // Cloudbeds: quem ficou com cada quarto (só para camareiras ligadas)
    const r = await chamarRota('/api/governanca-camareiras-cloudbeds', { acao: 'atribuir', atribuicoes }).catch(() => ({ ok: false, erro: 'falha de conexão' }));
    if (r.semLigacao === true) mostrarSync('ℹ️ Distribuição feita só aqui: as camareiras ainda não estão ligadas às da Cloudbeds (Configurações → Camareiras na Cloudbeds).');
    else if (!r.ok) mostrarSync(`⚠️ Distribuição feita aqui, mas a Cloudbeds não recebeu: ${r.erro || (r.erros || []).join(' | ')}`);
    else {
      const faltam = (r.semLigacao || []).map(nomeCamareira);
      mostrarSync(`✅ Cloudbeds avisada: ${r.enviados} quarto(s) com a camareira certa.${faltam.length ? ` Sem ligação: ${faltam.join(', ')}.` : ''}`);
    }
  }

  // ---- Vistoria ---------------------------------------------------------------
  function abrirVistoria(item) {
    setVistoria({ ...item, marcados: Object.fromEntries(ITENS_VISTORIA.map((i) => [i.chave, true])), observacao: '' });
  }

  async function concluirVistoria() {
    if (!vistoria) return;
    const { aprovado, falhas } = resultadoDaVistoria(vistoria.marcados);
    const { quarto, sessao } = vistoria;
    setOcupado('vistoria');
    const { error } = await supabase.from('governanca_vistorias').insert({
      hotel_id: usuario.hotel_id, quarto_id: quarto.id, quarto_numero: quarto.numero, sessao_id: sessao.id,
      camareira_id: sessao.camareira_id || null, camareira_nome: sessao.camareira_nome || nomeCamareira(sessao.camareira_id),
      vistoriado_por_id: usuario.id, vistoriado_por_nome: usuario.nome,
      resultado: aprovado ? 'APROVADO' : 'REPROVADO',
      itens: ITENS_VISTORIA.map((i) => ({ chave: i.chave, rotulo: i.rotulo, ok: vistoria.marcados[i.chave] !== false })),
      observacao: vistoria.observacao.trim().slice(0, 500) || null,
    });
    if (error) { setOcupado(''); setErro('Não foi possível salvar a vistoria. Detalhe técnico: ' + error.message); return; }

    if (aprovado) {
      setOcupado(''); setVistoria(null);
      mostrarAviso(`✅ Apartamento ${quarto.numero} aprovado na vistoria.`);
      const r = await chamarRota('/api/governanca-atualizar-cloudbeds', { quartoId: quarto.id, roomCondition: 'inspected' }).catch(() => ({ ok: false }));
      if (r.naoVinculado) mostrarSync(`ℹ️ Apartamento ${quarto.numero}: não está ligado à Cloudbeds.`);
      else if (!r.ok) mostrarSync(`ℹ️ Apartamento ${quarto.numero}: a Cloudbeds não aceitou "Inspecionado" (essa opção pode estar desligada lá). Lá ele continua "limpo".`);
      else mostrarSync(`✅ Apartamento ${quarto.numero}: "Inspecionado" na Cloudbeds.`);
    } else {
      // Volta para a mesma camareira, no topo da lista dela
      const campos = {
        status: 'SUJO',
        estado_apartamento: !quarto.estado_apartamento || quarto.estado_apartamento === 'LIMPO' ? 'SAIDA_SUJO' : quarto.estado_apartamento,
        camareira_id: sessao.camareira_id || quarto.camareira_id || null,
        prioridade: true,
        prioridade_obs: textoRefazer(falhas, vistoria.observacao),
      };
      const { error: e2 } = await supabase.from('quartos').update(campos).eq('id', quarto.id);
      setOcupado(''); setVistoria(null);
      if (e2) { setErro('A vistoria foi salva, mas o quarto não voltou para a lista. Detalhe técnico: ' + e2.message); return; }
      mostrarAviso(`↩️ Apartamento ${quarto.numero} voltou para ${nomeCamareira(campos.camareira_id)}, no topo da lista.`);
      chamarRota('/api/governanca-atualizar-cloudbeds', { quartoId: quarto.id, roomCondition: 'dirty' }).catch(() => null);
    }
    recarregar();
    carregar();
  }

  const resultadoAtual = vistoria ? resultadoDaVistoria(vistoria.marcados) : null;

  return (
    <section className="gp">
      <EstilosPainel />
      {erro && <div className="aviso-erro">{erro}</div>}

      <div className="gp-numeros">
        <div className="cartao gp-numero"><strong>{paraArrumar}</strong><span>Para arrumar</span></div>
        <div className="cartao gp-numero"><strong>{emArrumacao}</strong><span>Em arrumação</span></div>
        <div className="cartao gp-numero"><strong>{limposHoje}</strong><span>Arrumados hoje</span></div>
        <div className="cartao gp-numero"><strong>{filaVistoria.length}</strong><span>Para vistoriar</span></div>
        <div className="cartao gp-numero"><strong>{manutencao}</strong><span>Manutenção</span></div>
      </div>

      <PedidosRecepcao usuario={usuario} quartos={quartos} />

      {/* ---- Escala e distribuição ---- */}
      <div className="cartao gp-bloco">
        <div className="gp-cabeca">
          <h2>Escala de hoje</h2>
          <span className="texto-suave">
            {infoEscala.salvaHoje ? 'Salva hoje.' : infoEscala.copiadaDe ? `Preenchida igual a ${formatarDia(infoEscala.copiadaDe)} — confira e salve.` : 'Marque quem veio e o andar de cada uma.'}
          </span>
        </div>
        {escala.length === 0 ? (
          <p className="texto-suave">Nenhum usuário com o perfil &quot;Camareira&quot; neste hotel. Cadastre em Administração → Usuários.</p>
        ) : (
          <div className="gp-escala">
            {escala.map((l) => (
              <div key={l.camareira_id} className={l.presente ? 'gp-linha' : 'gp-linha gp-ausente'}>
                <label className="gp-presente">
                  <input type="checkbox" checked={l.presente} onChange={(e) => trocarLinha(l.camareira_id, { presente: e.target.checked })} />
                  <span>{l.camareira_nome}</span>
                </label>
                {l.presente ? (
                  <div className="gp-andares" role="group" aria-label={`Andares de ${l.camareira_nome}`}>
                    {andares.map((a) => (
                      <button key={a} type="button" className={l.andares.includes(a) ? 'gp-andar gp-andar-sim' : 'gp-andar'}
                        aria-pressed={l.andares.includes(a)} onClick={() => alternarAndar(l, a)}>
                        {nomeDoAndar(a)}
                      </button>
                    ))}
                    {l.andares.length === 0 && <span className="gp-qualquer">Qualquer andar</span>}
                  </div>
                ) : <span className="texto-suave gp-folga">Não veio hoje</span>}
              </div>
            ))}
          </div>
        )}
        <div className="gp-botoes">
          <button type="button" className="botao botao-suave" onClick={() => salvarEscala(false)} disabled={!!ocupado || !escala.length}>Salvar escala</button>
          <button type="button" className="botao botao-principal" onClick={verDistribuicao} disabled={!!ocupado || !escala.length}>
            {ocupado === 'previa' ? 'Calculando…' : '🧮 Distribuir quartos'}
          </button>
        </div>

        {previa && (
          <div className="gp-previa">
            <h3>Prévia — {previa.total} quarto(s)</h3>
            {previa.andaresSemNinguem.length > 0 && (
              <p className="gp-nota">Sem camareira escalada: {previa.andaresSemNinguem.map(nomeDoAndar).join(', ')} — foi dividido entre quem estava com menos trabalho.</p>
            )}
            <div className="gp-previa-lista">
              {previa.porCamareira.map((g) => (
                <div key={g.camareira_id} className="gp-previa-item">
                  <div className="gp-previa-topo">
                    <strong>{g.camareira_nome}</strong>
                    <span className="texto-suave">
                      {g.andares.length ? g.andares.map(nomeDoAndar).join(', ') : 'qualquer andar'} · {g.saidas} saída(s) + {g.ocupados} com hóspede
                      {g.emAndamento ? ` · ${g.emAndamento} em andamento` : ''}
                    </span>
                  </div>
                  <div className="gp-chips">
                    {g.quartos.length === 0 ? <span className="texto-suave">nenhum quarto</span> : g.quartos.map((q) => (
                      <span key={q.id} className={q.estado_apartamento === 'PREVISAO_SAIDA_OCUPADO' ? 'gp-chip gp-chip-previsao' : 'gp-chip'} title={rotuloDoEstado(q)}>
                        {q.prioridade ? '⭐' : ''}{q.numero}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            <p className="texto-suave gp-nota">
              {previa.mudancas.length} quarto(s) mudam de camareira. Quarto tracejado = previsão de saída (entra na lista dela no check-out).
            </p>
            <div className="gp-botoes">
              <button type="button" className="botao botao-principal" onClick={confirmarDistribuicao} disabled={!!ocupado}>
                {ocupado === 'confirmar' ? 'Gravando…' : '✅ Confirmar distribuição'}
              </button>
              <button type="button" className="botao botao-suave" onClick={() => setPrevia(null)} disabled={!!ocupado}>Cancelar</button>
            </div>
          </div>
        )}
      </div>

      {/* ---- Vistoria ---- */}
      <div className="cartao gp-bloco">
        <div className="gp-cabeca">
          <h2>Vistoria (opcional)</h2>
          <span className="texto-suave">Hoje: {aprovadasHoje} aprovada(s) · {reprovadasHoje} reprovada(s)</span>
        </div>
        {filaVistoria.length === 0 ? (
          <p className="texto-suave" style={{ margin: 0 }}>Nenhum quarto arrumado hoje esperando vistoria.</p>
        ) : (
          <div className="gp-vistorias">
            {filaVistoria.map((item) => (
              <div key={item.quarto.id} className="gp-vistoria-linha">
                <span className="gp-vistoria-numero">{item.quarto.numero}</span>
                <span className="gp-vistoria-info">
                  {item.sessao.camareira_nome || nomeCamareira(item.sessao.camareira_id)} · terminou às {hora(item.sessao.fim_em)}
                  {item.sessao.duracao_minutos ? ` · ${Math.round(item.sessao.duracao_minutos)} min` : ''}
                </span>
                <button type="button" className="botao botao-suave" onClick={() => abrirVistoria(item)}>🔍 Vistoriar</button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ---- Estoque e enxoval ---- */}
      <div className="cartao gp-bloco">
        <div className="gp-cabeca">
          <h2>Estoque e enxoval</h2>
          <a href="/estoque" className="gp-link">Abrir Estoque →</a>
        </div>
        {alertas.length === 0 ? (
          <p className="texto-suave" style={{ margin: 0 }}>Nada no mínimo. 👍</p>
        ) : (
          <ul className="gp-alertas">
            {alertas.slice(0, 10).map((a) => (
              <li key={a.chave} className={a.zerado ? 'gp-alerta gp-alerta-zerado' : 'gp-alerta'}>
                {a.zerado ? '🔴' : '🟡'} {a.enxoval ? '🧺 ' : ''}{textoDoAlerta(a)}
              </li>
            ))}
            {alertas.length > 10 && <li className="texto-suave">e mais {alertas.length - 10} no Estoque…</li>}
          </ul>
        )}
      </div>

      {/* ---- Janela da vistoria ---- */}
      {vistoria && (
        <div className="gv-overlay" role="dialog" aria-modal="true" aria-label={`Vistoria do apartamento ${vistoria.quarto.numero}`}>
          <div className="gv-modal">
            <h2 style={{ fontSize: '1.15rem', marginTop: 0 }}>Vistoria — Apartamento {vistoria.quarto.numero}</h2>
            <p className="texto-suave" style={{ fontSize: 13 }}>
              Arrumado por {vistoria.sessao.camareira_nome || nomeCamareira(vistoria.sessao.camareira_id)} às {hora(vistoria.sessao.fim_em)}. Marque ✗ no que não está bom.
            </p>
            <div className="gp-itens">
              {ITENS_VISTORIA.map((i) => {
                const ok = vistoria.marcados[i.chave] !== false;
                return (
                  <div key={i.chave} className={ok ? 'gp-item' : 'gp-item gp-item-falha'}>
                    <span>{i.rotulo}</span>
                    <div className="gp-item-botoes">
                      <button type="button" aria-pressed={ok} className={ok ? 'gp-ok gp-ativo' : 'gp-ok'}
                        onClick={() => setVistoria({ ...vistoria, marcados: { ...vistoria.marcados, [i.chave]: true } })} aria-label={`${i.rotulo}: ok`}>✓</button>
                      <button type="button" aria-pressed={!ok} className={!ok ? 'gp-falha gp-ativo' : 'gp-falha'}
                        onClick={() => setVistoria({ ...vistoria, marcados: { ...vistoria.marcados, [i.chave]: false } })} aria-label={`${i.rotulo}: refazer`}>✗</button>
                    </div>
                  </div>
                );
              })}
            </div>
            <label className="rotulo" htmlFor="gp-obs">Observação (opcional)</label>
            <textarea id="gp-obs" className="campo" rows={2} maxLength={500} value={vistoria.observacao}
              onChange={(e) => setVistoria({ ...vistoria, observacao: e.target.value })} placeholder="Ex.: faltou sabonete no box" />
            {!resultadoAtual.aprovado && (
              <p className="gp-nota">Ao reprovar, o quarto volta para {vistoria.sessao.camareira_nome || 'a camareira'}, no topo da lista, com o aviso: &quot;{textoRefazer(resultadoAtual.falhas, vistoria.observacao)}&quot;.</p>
            )}
            <div className="gv-modal-botoes">
              <button type="button" className={resultadoAtual.aprovado ? 'botao botao-principal' : 'botao botao-perigo'} onClick={concluirVistoria} disabled={!!ocupado}>
                {ocupado === 'vistoria' ? 'Salvando…' : resultadoAtual.aprovado ? '✅ Aprovar' : '↩️ Reprovar e devolver'}
              </button>
              <button type="button" className="botao botao-suave" onClick={() => setVistoria(null)} disabled={!!ocupado}>Cancelar</button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

function EstilosPainel() {
  return (
    <style>{`
      .gp { display: flex; flex-direction: column; gap: 14px; }
      .gp-numeros { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
      .gp-numero { display: flex; flex-direction: column; align-items: center; padding: 14px 8px; text-align: center; }
      .gp-numero strong { font-family: var(--fonte-titulo); font-size: 28px; color: var(--marca); line-height: 1.1; }
      .gp-numero span { font-size: 12px; color: var(--texto-suave); margin-top: 2px; }
      .gp-bloco { padding: 16px; }
      .gp-cabeca { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: baseline; gap: 4px 12px; margin-bottom: 10px; }
      .gp-cabeca h2 { font-size: 1.1rem; margin: 0; }
      .gp-cabeca .texto-suave { font-size: 12px; }
      .gp-escala { display: flex; flex-direction: column; gap: 8px; }
      .gp-linha { display: flex; flex-direction: column; gap: 6px; padding: 10px 0; border-bottom: 1px solid var(--borda); }
      .gp-ausente .gp-presente span { color: var(--texto-suave); text-decoration: line-through; }
      .gp-presente { display: flex; align-items: center; gap: 10px; font-weight: 700; font-size: 15px; cursor: pointer; }
      .gp-presente input { width: 22px; height: 22px; }
      .gp-andares { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; padding-left: 32px; }
      .gp-andar { border: 1px solid var(--borda); background: var(--branco); color: var(--tinta); border-radius: 999px; padding: 8px 12px; font-size: 13px; font-weight: 600; cursor: pointer; min-height: 38px; font-family: inherit; }
      .gp-andar-sim { background: var(--marca); border-color: var(--marca); color: var(--branco); }
      .gp-qualquer, .gp-folga { font-size: 12px; color: var(--texto-suave); }
      .gp-folga { padding-left: 32px; }
      .gp-botoes { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; }
      .gp-previa { margin-top: 14px; border-top: 2px dashed var(--borda); padding-top: 12px; }
      .gp-previa h3 { font-size: 1rem; margin: 0 0 6px; }
      .gp-previa-lista { display: flex; flex-direction: column; gap: 10px; }
      .gp-previa-item { background: var(--fundo, #F6F6F3); border-radius: 12px; padding: 10px 12px; }
      .gp-previa-topo { display: flex; flex-direction: column; gap: 2px; margin-bottom: 6px; }
      .gp-previa-topo .texto-suave { font-size: 12px; }
      .gp-chips { display: flex; flex-wrap: wrap; gap: 6px; }
      .gp-chip { background: var(--branco); border: 1px solid var(--borda); border-radius: 8px; padding: 4px 8px; font-weight: 700; font-size: 13px; }
      .gp-chip-previsao { border-style: dashed; color: var(--texto-suave); }
      .gp-nota { font-size: 12px; margin: 8px 0 0; color: #7A5A00; }
      .gp-vistorias { display: flex; flex-direction: column; gap: 6px; }
      .gp-vistoria-linha { display: flex; align-items: center; gap: 10px; padding: 8px 0; border-bottom: 1px solid var(--borda); flex-wrap: wrap; }
      .gp-vistoria-numero { font-family: var(--fonte-titulo); font-weight: 700; font-size: 20px; min-width: 52px; }
      .gp-vistoria-info { flex: 1; font-size: 13px; color: var(--texto-suave); min-width: 140px; }
      .gp-link { font-size: 13px; font-weight: 700; color: var(--marca); }
      .gp-alertas { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 6px; font-size: 13px; }
      .gp-alerta-zerado { font-weight: 700; }
      .gp-itens { display: flex; flex-direction: column; gap: 2px; margin: 8px 0 10px; }
      .gp-item { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 8px 0; border-bottom: 1px solid var(--borda); font-size: 14px; }
      .gp-item-falha span { color: #A31212; font-weight: 600; }
      .gp-item-botoes { display: flex; gap: 6px; flex-shrink: 0; }
      .gp-ok, .gp-falha { width: 44px; height: 40px; border-radius: 10px; border: 1px solid var(--borda); background: var(--branco); font-size: 18px; cursor: pointer; color: var(--texto-suave); }
      .gp-ok.gp-ativo { background: #DDF2E4; border-color: #1E6B3C; color: #1E6B3C; }
      .gp-falha.gp-ativo { background: #FBDDDD; border-color: #A31212; color: #A31212; }
      @media (min-width: 640px) {
        .gp-numeros { grid-template-columns: repeat(5, 1fr); }
        .gp-linha { flex-direction: row; align-items: center; justify-content: space-between; }
        .gp-andares, .gp-folga { padding-left: 0; justify-content: flex-end; }
      }
    `}</style>
  );
}
