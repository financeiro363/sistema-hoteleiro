'use client';

// ============================================================================
// CONTABILIDADE
// - Acesso restrito a ADMIN e ao novo papel CONTADOR (mais ninguém)
// - Lançamentos: nome do documento, forma de pagamento, vencimento, valor,
//   link do Google Drive (mesmo padrão do Créditos e Devoluções — só o link
//   é guardado, não o arquivo). Botão "Falta lançar" (vermelho) vira
//   "Já lançado" (verde) num clique; SÓ ADMIN pode desfazer. Contador de
//   pendências no topo; lista se auto-organiza: pendentes primeiro
//   (vencimento mais urgente), lançados depois (mais recente primeiro).
// - Extratos Bancários: banco + mês/ano + tipo + link, agrupados por ano.
// - Log de Auditoria: só ADMIN vê.
// ============================================================================

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '../../lib/supabaseClient';

// ---- Constantes -------------------------------------------------------------

const FORMA_PAGAMENTO_SUGESTOES = [
  'Boleto Bancário', 'Pix - Stone', 'Pix - Banco do Brasil', 'Pix - Cora',
  'Cartão', 'Transferência', 'Dinheiro', 'Outro',
];
const TIPO_EXTRATO = ['Extrato Bancário', 'Contrato', 'Certidão'];

// ---- Funções de apoio -------------------------------------------------------

function dinheiro(valor) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(valor || 0));
}
function formatarData(valor) {
  if (!valor) return '—';
  const [ano, mes, dia] = String(valor).slice(0, 10).split('-');
  return `${dia}/${mes}/${ano}`;
}
function formatarDataHora(valor) {
  if (!valor) return '—';
  try {
    return new Date(valor).toLocaleString('pt-BR', {
      day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
    });
  } catch (e) { return String(valor); }
}
function formatarMesAno(mesAno) {
  if (!mesAno) return '—';
  const [ano, mes] = mesAno.split('-');
  const MESES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
  return `${MESES[Number(mes) - 1] || mes}/${ano}`;
}

// ---- Componente principal ---------------------------------------------------

export default function Contabilidade() {
  const router = useRouter();

  const [verificandoLogin, setVerificandoLogin] = useState(true);
  const [usuario, setUsuario] = useState(null);
  const [nomesUsuarios, setNomesUsuarios] = useState({});

  const [subAba, setSubAba] = useState('lancamentos'); // lancamentos | extratos | log
  const [lancamentos, setLancamentos] = useState([]);
  const [extratos, setExtratos] = useState([]);
  const [logs, setLogs] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');
  const [aviso, setAviso] = useState('');
  const [salvando, setSalvando] = useState(false);

  // Lançamentos — busca/filtro
  const [busca, setBusca] = useState('');
  const [filtroStatus, setFiltroStatus] = useState('TODOS');
  const [mostrarFormLanc, setMostrarFormLanc] = useState(false);
  const [fNomeDoc, setFNomeDoc] = useState('');
  const [fFormaPagamento, setFFormaPagamento] = useState(FORMA_PAGAMENTO_SUGESTOES[0]);
  const [fVencimento, setFVencimento] = useState('');
  const [fValor, setFValor] = useState('');
  const [fLinkDrive, setFLinkDrive] = useState('');
  const [erroFormLanc, setErroFormLanc] = useState('');
  const [excluindoLancId, setExcluindoLancId] = useState(null);

  // Extratos — novo
  const [mostrarFormExtrato, setMostrarFormExtrato] = useState(false);
  const [eBanco, setEBanco] = useState('');
  const [eMesAno, setEMesAno] = useState(new Date().toISOString().slice(0, 7));
  const [eTipo, setETipo] = useState('Extrato Bancário');
  const [eLinkDrive, setELinkDrive] = useState('');
  const [erroFormExtrato, setErroFormExtrato] = useState('');
  const [excluindoExtratoId, setExcluindoExtratoId] = useState(null);
  const [filtroTipoExtrato, setFiltroTipoExtrato] = useState('TODOS');

  const souAdmin = usuario?.papel === 'ADMIN';

  function mostrarAviso(texto) { setAviso(texto); setTimeout(() => setAviso(''), 5000); }
  const nomeDe = useCallback((id) => (id ? nomesUsuarios[id] || `Usuário #${id}` : '—'), [nomesUsuarios]);

  // ---- Login: ADMIN ou CONTADOR ----
  useEffect(() => {
    let ativo = true;
    async function verificar() {
      const { data: sessao } = await supabase.auth.getSession();
      if (!sessao?.session) { router.push('/login'); return; }
      const { data: dadosUsuario, error } = await supabase
        .from('usuarios').select('*').eq('auth_id', sessao.session.user.id).single();
      if (error || !dadosUsuario) { router.push('/login'); return; }
      if (dadosUsuario.papel !== 'ADMIN' && dadosUsuario.papel !== 'CONTADOR') { router.push('/'); return; }
      if (!ativo) return;
      setUsuario(dadosUsuario);
      setVerificandoLogin(false);
    }
    verificar();
    return () => { ativo = false; };
  }, [router]);

  const carregarTudo = useCallback(async (u) => {
    setCarregando(true);
    setErro('');
    const [l, e, pessoas] = await Promise.all([
      supabase.from('contabilidade_lancamentos').select('*'),
      supabase.from('contabilidade_extratos').select('*'),
      supabase.from('usuarios').select('id, nome'),
    ]);
    if (l.error) setErro('Não foi possível carregar. Detalhe técnico: ' + l.error.message);
    setLancamentos(l.data || []);
    setExtratos(e.data || []);
    if (pessoas.data) {
      const mapa = {};
      pessoas.data.forEach((p) => { mapa[p.id] = p.nome; });
      setNomesUsuarios(mapa);
    }
    if (u.papel === 'ADMIN') {
      const { data: ls } = await supabase.from('contabilidade_log').select('*').order('data_hora', { ascending: false }).limit(300);
      setLogs(ls || []);
    }
    setCarregando(false);
  }, []);

  useEffect(() => { if (usuario) carregarTudo(usuario); }, [usuario, carregarTudo]);

  async function registrarLog(acao, detalhe) {
    await supabase.from('contabilidade_log').insert({ usuario_id: usuario.id, acao, detalhe, hotel_id: usuario.hotel_id });
  }

  // ================= LANÇAMENTOS =================

  async function cadastrarLancamento(evento) {
    evento.preventDefault();
    if (salvando) return;
    setErroFormLanc('');
    if (!fNomeDoc.trim()) { setErroFormLanc('Informe o nome do documento.'); return; }
    if (!fVencimento) { setErroFormLanc('Informe a data de vencimento.'); return; }
    if (!(Number(fValor) > 0)) { setErroFormLanc('Informe um valor maior que zero.'); return; }

    setSalvando(true);
    const { error } = await supabase.from('contabilidade_lancamentos').insert({
      nome_documento: fNomeDoc.trim(), forma_pagamento: fFormaPagamento,
      data_vencimento: fVencimento, valor: Number(fValor), link_drive: fLinkDrive.trim() || null,
      criado_por_id: usuario.id, hotel_id: usuario.hotel_id,
    });
    setSalvando(false);
    if (error) { setErroFormLanc('Não foi possível cadastrar. Detalhe técnico: ' + error.message); return; }
    await registrarLog('Cadastrou Lançamento', `${fNomeDoc.trim()} — ${dinheiro(fValor)}, vence em ${formatarData(fVencimento)}.`);
    setFNomeDoc(''); setFFormaPagamento(FORMA_PAGAMENTO_SUGESTOES[0]); setFVencimento(''); setFValor(''); setFLinkDrive('');
    setMostrarFormLanc(false);
    mostrarAviso('Lançamento cadastrado!');
    carregarTudo(usuario);
  }

  async function marcarLancado(item) {
    if (salvando) return;
    setSalvando(true);
    const agora = new Date().toISOString();
    const { error } = await supabase.from('contabilidade_lancamentos')
      .update({ status: 'LANCADO', lancado_por_id: usuario.id, lancado_em: agora }).eq('id', item.id);
    setSalvando(false);
    if (error) { setErro('Não foi possível atualizar. Detalhe técnico: ' + error.message); return; }
    await registrarLog('Marcou como Lançado', `${item.nome_documento} — ${dinheiro(item.valor)}.`);
    mostrarAviso('Marcado como lançado!');
    carregarTudo(usuario);
  }

  async function desfazerLancamento(item) {
    if (salvando || !souAdmin) return;
    setSalvando(true);
    const { error } = await supabase.from('contabilidade_lancamentos')
      .update({ status: 'PENDENTE', lancado_por_id: null, lancado_em: null }).eq('id', item.id);
    setSalvando(false);
    if (error) { setErro('Não foi possível desfazer. Detalhe técnico: ' + error.message); return; }
    await registrarLog('Desfez Lançamento', `${item.nome_documento} voltou para pendente.`);
    mostrarAviso('Lançamento desfeito — voltou para pendente.');
    carregarTudo(usuario);
  }

  async function excluirLancamento(item) {
    setExcluindoLancId(null);
    await registrarLog('Excluiu Lançamento', `${item.nome_documento} removido.`);
    const { error } = await supabase.from('contabilidade_lancamentos').delete().eq('id', item.id);
    if (error) { setErro('Não foi possível excluir. Detalhe técnico: ' + error.message); return; }
    mostrarAviso('Lançamento excluído.');
    carregarTudo(usuario);
  }

  const termoLanc = busca.trim().toLowerCase();
  const pendentesCount = lancamentos.filter((l) => l.status === 'PENDENTE').length;
  const lancamentosFiltrados = lancamentos
    .filter((l) => (filtroStatus === 'TODOS' ? true : l.status === filtroStatus))
    .filter((l) => !termoLanc || l.nome_documento.toLowerCase().includes(termoLanc) || String(l.valor).includes(termoLanc))
    .sort((a, b) => {
      if (a.status !== b.status) return a.status === 'PENDENTE' ? -1 : 1;
      return a.status === 'PENDENTE'
        ? new Date(a.data_vencimento) - new Date(b.data_vencimento)
        : new Date(b.data_vencimento) - new Date(a.data_vencimento);
    });

  // ================= EXTRATOS =================

  async function cadastrarExtrato(evento) {
    evento.preventDefault();
    if (salvando) return;
    setErroFormExtrato('');
    if (!eBanco.trim()) { setErroFormExtrato('Informe o banco.'); return; }
    if (!eMesAno) { setErroFormExtrato('Informe o mês/ano.'); return; }

    setSalvando(true);
    const { error } = await supabase.from('contabilidade_extratos').insert({
      banco: eBanco.trim(), mes_ano: eMesAno, tipo: eTipo, link_drive: eLinkDrive.trim() || null,
      criado_por_id: usuario.id, hotel_id: usuario.hotel_id,
    });
    setSalvando(false);
    if (error) { setErroFormExtrato('Não foi possível cadastrar. Detalhe técnico: ' + error.message); return; }
    await registrarLog('Cadastrou Extrato', `${eTipo} — ${eBanco.trim()} (${formatarMesAno(eMesAno)}).`);
    setEBanco(''); setEMesAno(new Date().toISOString().slice(0, 7)); setETipo('Extrato Bancário'); setELinkDrive('');
    setMostrarFormExtrato(false);
    mostrarAviso('Extrato cadastrado!');
    carregarTudo(usuario);
  }

  async function excluirExtrato(item) {
    setExcluindoExtratoId(null);
    await registrarLog('Excluiu Extrato', `${item.tipo} — ${item.banco} (${formatarMesAno(item.mes_ano)}) removido.`);
    const { error } = await supabase.from('contabilidade_extratos').delete().eq('id', item.id);
    if (error) { setErro('Não foi possível excluir. Detalhe técnico: ' + error.message); return; }
    mostrarAviso('Extrato excluído.');
    carregarTudo(usuario);
  }

  const extratosFiltrados = extratos.filter((e) => filtroTipoExtrato === 'TODOS' ? true : e.tipo === filtroTipoExtrato);
  const extratosPorAno = {};
  extratosFiltrados.forEach((e) => {
    const ano = (e.mes_ano || '').split('-')[0] || '?';
    extratosPorAno[ano] = extratosPorAno[ano] || [];
    extratosPorAno[ano].push(e);
  });
  const anosOrdenados = Object.keys(extratosPorAno).sort((a, b) => b.localeCompare(a));
  anosOrdenados.forEach((ano) => extratosPorAno[ano].sort((a, b) => b.mes_ano.localeCompare(a.mes_ano)));

  if (verificandoLogin) {
    return <main className="conteudo"><p className="texto-suave">Verificando seu acesso…</p></main>;
  }

  return (
    <main className="conteudo">
      <EstilosContabilidade />

      <span className="olho">Financeiro Contábil</span>
      <h1 style={{ marginBottom: 6 }}>Contabilidade</h1>
      <p className="texto-suave" style={{ fontSize: 13, marginTop: -4 }}>
        Módulo visível só para administradores e contadores.
      </p>

      {aviso && <div className="aviso-sucesso">{aviso}</div>}
      {erro && <div className="aviso-erro">{erro}</div>}

      <nav className="ct-abas" aria-label="Seções">
        <button type="button" className={subAba === 'lancamentos' ? 'ct-aba ct-aba-ativa' : 'ct-aba'} onClick={() => setSubAba('lancamentos')}>
          Lançamentos {pendentesCount > 0 && <span className="ct-contador">{pendentesCount} pendente(s)</span>}
        </button>
        <button type="button" className={subAba === 'extratos' ? 'ct-aba ct-aba-ativa' : 'ct-aba'} onClick={() => setSubAba('extratos')}>
          Extratos Bancários
        </button>
        {souAdmin && (
          <button type="button" className={subAba === 'log' ? 'ct-aba ct-aba-ativa' : 'ct-aba'} onClick={() => setSubAba('log')}>
            Log de Auditoria
          </button>
        )}
      </nav>

      {carregando ? <p className="texto-suave">Carregando…</p> : (
        <>
          {/* ================= LANÇAMENTOS ================= */}
          {subAba === 'lancamentos' && (
            <section>
              <div className="ct-barra">
                <input className="campo" type="search" value={busca} onChange={(e) => setBusca(e.target.value)}
                  placeholder="Buscar por nome do documento ou valor…" />
                <select className="campo" value={filtroStatus} onChange={(e) => setFiltroStatus(e.target.value)}>
                  <option value="TODOS">Todos os status</option>
                  <option value="PENDENTE">Falta lançar</option>
                  <option value="LANCADO">Já lançado</option>
                </select>
                <button type="button" className="botao botao-principal" onClick={() => { setMostrarFormLanc(!mostrarFormLanc); setErroFormLanc(''); }}>
                  {mostrarFormLanc ? 'Fechar' : '+ Novo Lançamento'}
                </button>
              </div>

              {mostrarFormLanc && (
                <form className="cartao" style={{ marginBottom: 16 }} onSubmit={cadastrarLancamento}>
                  <h2 style={{ fontSize: '1.1rem', marginBottom: 4 }}>Novo lançamento</h2>
                  <label className="rotulo">Nome do documento *</label>
                  <input className="campo" type="text" value={fNomeDoc} onChange={(e) => setFNomeDoc(e.target.value)} placeholder="Ex.: Sindicato dos Transportes" />
                  <div className="ct-duas">
                    <div>
                      <label className="rotulo">Forma de pagamento</label>
                      <select className="campo" value={fFormaPagamento} onChange={(e) => setFFormaPagamento(e.target.value)}>
                        {FORMA_PAGAMENTO_SUGESTOES.map((f) => <option key={f} value={f}>{f}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="rotulo">Vencimento *</label>
                      <input className="campo" type="date" value={fVencimento} onChange={(e) => setFVencimento(e.target.value)} />
                    </div>
                  </div>
                  <label className="rotulo">Valor (R$) *</label>
                  <input className="campo" type="number" min="0.01" step="0.01" value={fValor} onChange={(e) => setFValor(e.target.value)} placeholder="0,00" />
                  <label className="rotulo">Link do Google Drive (comprovante/boleto)</label>
                  <input className="campo" type="url" value={fLinkDrive} onChange={(e) => setFLinkDrive(e.target.value)} placeholder="https://drive.google.com/…" />
                  {erroFormLanc && <div className="aviso-erro">{erroFormLanc}</div>}
                  <button type="submit" className="botao botao-principal" disabled={salvando} style={{ marginTop: 12 }}>
                    {salvando ? 'Enviando…' : 'Enviar'}
                  </button>
                </form>
              )}

              <p className="texto-suave" style={{ fontSize: 13 }}>{lancamentosFiltrados.length} documento(s)</p>

              {lancamentosFiltrados.length === 0 ? (
                <div className="cartao" style={{ textAlign: 'center', color: 'var(--texto-suave)' }}>Nenhum lançamento encontrado.</div>
              ) : (
                <div className="ct-lista">
                  {lancamentosFiltrados.map((l) => {
                    const lancado = l.status === 'LANCADO';
                    return (
                      <div key={l.id} className="cartao ct-item" style={lancado ? { borderColor: '#A7E8D5' } : undefined}>
                        <div className="ct-item-esq">
                          <div className="ct-item-topo">
                            <strong>{l.nome_documento}</strong>
                            <span className="ct-badge" style={lancado ? { background: '#DDF2E4', color: '#1E6B3C' } : { background: '#FBDDDD', color: '#A31212' }}>
                              {lancado ? 'Já lançado' : 'Falta lançar'}
                            </span>
                          </div>
                          <div className="texto-suave" style={{ fontSize: 13 }}>
                            {l.forma_pagamento || '—'} · Vencimento: {formatarData(l.data_vencimento)}
                            {l.link_drive && <> · <a href={l.link_drive} target="_blank" rel="noopener noreferrer">Ver documento</a></>}
                          </div>
                          {lancado && (
                            <div className="texto-suave" style={{ fontSize: 12, marginTop: 2 }}>
                              Lançado por {nomeDe(l.lancado_por_id)} em {formatarDataHora(l.lancado_em)}
                            </div>
                          )}
                        </div>
                        <div className="ct-item-dir">
                          <div className="ct-valor">{dinheiro(l.valor)}</div>
                          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                            {!lancado && (
                              <button type="button" className="botao botao-principal" onClick={() => marcarLancado(l)} disabled={salvando}>Falta lançar</button>
                            )}
                            {lancado && souAdmin && (
                              <button type="button" className="botao botao-suave" onClick={() => desfazerLancamento(l)} disabled={salvando}>Desfazer</button>
                            )}
                            {souAdmin && (
                              excluindoLancId === l.id ? (
                                <span className="ct-confirmar">
                                  Excluir?
                                  <button type="button" className="botao botao-perigo" onClick={() => excluirLancamento(l)}>Sim</button>
                                  <button type="button" className="botao botao-suave" onClick={() => setExcluindoLancId(null)}>Não</button>
                                </span>
                              ) : (
                                <button type="button" className="botao botao-suave" onClick={() => setExcluindoLancId(l.id)}>Excluir</button>
                              )
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          )}

          {/* ================= EXTRATOS ================= */}
          {subAba === 'extratos' && (
            <section>
              <div className="ct-barra">
                <select className="campo" value={filtroTipoExtrato} onChange={(e) => setFiltroTipoExtrato(e.target.value)}>
                  <option value="TODOS">Todos os tipos</option>
                  {TIPO_EXTRATO.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
                <button type="button" className="botao botao-principal" onClick={() => { setMostrarFormExtrato(!mostrarFormExtrato); setErroFormExtrato(''); }}>
                  {mostrarFormExtrato ? 'Fechar' : '+ Novo Extrato'}
                </button>
              </div>

              {mostrarFormExtrato && (
                <form className="cartao" style={{ marginBottom: 16 }} onSubmit={cadastrarExtrato}>
                  <h2 style={{ fontSize: '1.1rem', marginBottom: 4 }}>Novo extrato/documento</h2>
                  <label className="rotulo">Banco *</label>
                  <input className="campo" type="text" value={eBanco} onChange={(e) => setEBanco(e.target.value)} placeholder="Ex.: Banco do Brasil" />
                  <div className="ct-duas">
                    <div>
                      <label className="rotulo">Mês/Ano *</label>
                      <input className="campo" type="month" value={eMesAno} onChange={(e) => setEMesAno(e.target.value)} />
                    </div>
                    <div>
                      <label className="rotulo">Tipo</label>
                      <select className="campo" value={eTipo} onChange={(e) => setETipo(e.target.value)}>
                        {TIPO_EXTRATO.map((t) => <option key={t} value={t}>{t}</option>)}
                      </select>
                    </div>
                  </div>
                  <label className="rotulo">Link do Google Drive</label>
                  <input className="campo" type="url" value={eLinkDrive} onChange={(e) => setELinkDrive(e.target.value)} placeholder="https://drive.google.com/…" />
                  {erroFormExtrato && <div className="aviso-erro">{erroFormExtrato}</div>}
                  <button type="submit" className="botao botao-principal" disabled={salvando} style={{ marginTop: 12 }}>
                    {salvando ? 'Salvando…' : 'Salvar'}
                  </button>
                </form>
              )}

              {anosOrdenados.length === 0 ? (
                <div className="cartao" style={{ textAlign: 'center', color: 'var(--texto-suave)' }}>Nenhum extrato cadastrado.</div>
              ) : (
                anosOrdenados.map((ano) => (
                  <div key={ano} style={{ marginBottom: 18 }}>
                    <h3 className="ct-ano-titulo">Ano {ano}</h3>
                    <div className="ct-lista">
                      {extratosPorAno[ano].map((e) => (
                        <div key={e.id} className="cartao ct-item-extrato">
                          <div>
                            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                              <strong>{formatarMesAno(e.mes_ano)}</strong>
                              <span className="ct-badge" style={{ background: '#F0F0F0', color: 'var(--texto-suave)' }}>{e.tipo}</span>
                            </div>
                            <div className="texto-suave" style={{ fontSize: 13 }}>{e.banco}</div>
                          </div>
                          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                            {e.link_drive && <a href={e.link_drive} target="_blank" rel="noopener noreferrer" className="botao botao-contorno">Visualizar</a>}
                            {souAdmin && (
                              excluindoExtratoId === e.id ? (
                                <span className="ct-confirmar">
                                  Excluir?
                                  <button type="button" className="botao botao-perigo" onClick={() => excluirExtrato(e)}>Sim</button>
                                  <button type="button" className="botao botao-suave" onClick={() => setExcluindoExtratoId(null)}>Não</button>
                                </span>
                              ) : (
                                <button type="button" className="botao botao-suave" onClick={() => setExcluindoExtratoId(e.id)}>Excluir</button>
                              )
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))
              )}
            </section>
          )}

          {/* ================= LOG (admin) ================= */}
          {subAba === 'log' && souAdmin && (
            <section className="ct-lista">
              {logs.length === 0 ? (
                <div className="cartao" style={{ textAlign: 'center', color: 'var(--texto-suave)' }}>Nenhum registro no log ainda.</div>
              ) : (
                logs.map((l) => (
                  <div key={l.id} className="cartao" style={{ padding: '12px 16px' }}>
                    <div><strong>{nomeDe(l.usuario_id)}</strong> <span className="ct-log-acao">{l.acao}</span></div>
                    {l.detalhe && <div style={{ fontSize: 14, marginTop: 3 }}>{l.detalhe}</div>}
                    <div className="texto-suave" style={{ fontSize: 12 }}>{formatarDataHora(l.data_hora)}</div>
                  </div>
                ))
              )}
            </section>
          )}
        </>
      )}
    </main>
  );
}

// ---- Estilos específicos deste módulo ---------------------------------------

function EstilosContabilidade() {
  return (
    <style>{`
      .ct-abas { display: flex; gap: 6px; overflow-x: auto; margin: 14px 0 16px; padding-bottom: 4px; }
      .ct-aba {
        border: 1px solid var(--borda); background: var(--branco); color: var(--tinta);
        border-radius: 999px; padding: 10px 16px; font-size: 14px; font-weight: 600;
        cursor: pointer; white-space: nowrap; min-height: 42px;
      }
      .ct-aba-ativa { background: var(--marca); border-color: var(--marca); color: var(--branco); }
      .ct-contador { display: inline-block; margin-left: 6px; font-size: 12px; background: rgba(163,18,18,0.12); color: var(--erro-texto); border-radius: 999px; padding: 1px 8px; font-weight: 700; }

      .ct-barra { display: flex; flex-direction: column; gap: 10px; margin-bottom: 14px; }
      .ct-duas { display: grid; grid-template-columns: 1fr; gap: 0 14px; }

      .ct-lista { display: flex; flex-direction: column; gap: 12px; }
      .ct-item { display: flex; flex-direction: column; gap: 10px; padding: 16px; }
      .ct-item-topo { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
      .ct-item-topo strong { font-size: 16px; }
      .ct-badge { display: inline-block; font-size: 12px; font-weight: 700; border-radius: 999px; padding: 3px 10px; }
      .ct-valor { font-family: var(--fonte-titulo); font-weight: 700; font-size: 19px; color: var(--marca); }
      .ct-confirmar { display: inline-flex; align-items: center; gap: 6px; font-size: 13px; font-weight: 600; color: var(--erro-texto); flex-wrap: wrap; }

      .ct-ano-titulo { font-size: 14px; font-weight: 700; color: var(--texto-suave); text-align: center; border-bottom: 1px solid var(--borda); padding-bottom: 8px; margin-bottom: 10px; }
      .ct-item-extrato { display: flex; flex-direction: column; gap: 10px; padding: 14px 16px; }

      .ct-log-acao { font-size: 12px; font-weight: 700; color: var(--marca); background: var(--marca-clara); border-radius: 999px; padding: 2px 9px; }

      @media (min-width: 640px) {
        .ct-barra { flex-direction: row; align-items: center; }
        .ct-barra .campo { flex: 1; }
        .ct-duas { grid-template-columns: 1fr 1fr; }
        .ct-item { flex-direction: row; justify-content: space-between; }
        .ct-item-dir { text-align: right; }
        .ct-item-extrato { flex-direction: row; justify-content: space-between; align-items: center; }
      }
    `}</style>
  );
}
