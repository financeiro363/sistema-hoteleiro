'use client';

// ============================================================================
// CAIXA DE ENTRADA — Cotação (Fase 3)
// ============================================================================
// - ModalCotacao: datas e hóspedes → preço e disponibilidade da Cloudbeds
//   (tarifa padrão do motor) → prévia → envia pelo WhatsApp ou e-mail com o
//   link "Reservar agora" de cada quarto
// - ListaCotacoes: cotações da conversa (enviada, clicou, reservou)
// ============================================================================

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../../../lib/supabaseClient';
import { chamarApi, dataHora } from './util';
import { textoCotacao, ABERTURA_PADRAO, FINAL_PADRAO, reais, dataBR } from '../../../lib/atendimento/cotacaoTexto';

const DIA_MS = 86400000;
const hoje = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Fortaleza' });
const somarDias = (iso, n) => new Date(Date.parse(`${iso}T12:00:00Z`) + n * DIA_MS).toISOString().slice(0, 10);
const noitesEntre = (a, b) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / DIA_MS);

export function ModalCotacao({ conversa, canal, janelaAberta, onFechar, onEnviada }) {
  const [checkin, setCheckin] = useState('');
  const [checkout, setCheckout] = useState('');
  const [adultos, setAdultos] = useState(2);
  const [criancas, setCriancas] = useState(0);
  const [quartos, setQuartos] = useState(1);
  const [resultado, setResultado] = useState(null);
  const [escolhidos, setEscolhidos] = useState([]);
  const [abertura, setAbertura] = useState('');
  const [final, setFinal] = useState('');
  const [editarTexto, setEditarTexto] = useState(false);
  const [buscando, setBuscando] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState('');

  const noites = checkin && checkout ? noitesEntre(checkin, checkout) : 0;
  const ehEmail = canal?.tipo === 'EMAIL';
  const bloqueadoJanela = canal?.tipo === 'WHATSAPP' && !janelaAberta;

  async function buscar(e) {
    e?.preventDefault();
    setErro('');
    if (!checkin || !checkout) { setErro('Escolha as datas de entrada e de saída.'); return; }
    if (noites < 1) { setErro('A saída tem que ser depois da entrada.'); return; }
    setBuscando(true);
    try {
      const r = await chamarApi('/api/atendimento', {
        acao: 'cotacao_buscar', conversaId: conversa.id, checkin, checkout,
        adultos: Number(adultos), criancas: Number(criancas), quartos: Number(quartos),
      });
      setResultado(r);
      setEscolhidos(r.itens.slice(0, 8).map((i) => i.tipoId));
      setAbertura((atual) => atual || r.abertura || ABERTURA_PADRAO);
      setFinal((atual) => atual || r.final || FINAL_PADRAO);
    } catch (er) { setErro(er.message); setResultado(null); }
    setBuscando(false);
  }

  function alternar(id) {
    setEscolhidos((lista) => {
      if (lista.includes(id)) return lista.filter((x) => x !== id);
      if (lista.length >= 8) { setErro('No máximo 8 quartos por cotação.'); return lista; }
      return [...lista, id];
    });
  }

  const itensEscolhidos = useMemo(() => (resultado?.itens || []).filter((i) => escolhidos.includes(i.tipoId)), [resultado, escolhidos]);
  const previa = resultado && itensEscolhidos.length
    ? textoCotacao({
      cot: resultado, itens: itensEscolhidos, links: itensEscolhidos.map((_, n) => `https://…/r/••••-${n + 1}`),
      abertura, final, nomeCliente: conversa.contato_nome, nomeHotel: resultado.nomeHotel,
    })
    : '';

  async function enviar() {
    setEnviando(true);
    setErro('');
    try {
      await chamarApi('/api/atendimento', {
        acao: 'cotacao_enviar', conversaId: conversa.id, checkin, checkout,
        adultos: Number(adultos), criancas: Number(criancas), quartos: Number(quartos),
        tipos: escolhidos, abertura, final,
      });
      onEnviada();
    } catch (er) { setErro(er.message); setEnviando(false); }
  }

  return (
    <div className="at-overlay" role="dialog" aria-modal="true" aria-label="Cotação">
      <div className="at-modal at-modal-largo">
        <div className="at-modal-topo">
          <h2>💰 Cotação</h2>
          <button type="button" className="at-btn" onClick={onFechar} aria-label="Fechar">✕</button>
        </div>
        <p className="at-dica" style={{ marginTop: 0 }}>
          Preço e disponibilidade da Cloudbeds (tarifa padrão do motor). O cliente recebe um link “Reservar agora” para cada quarto, que abre o motor com as datas já escolhidas.
        </p>

        <form className="ct-busca" onSubmit={buscar}>
          <label><span>Entrada</span>
            <input type="date" className="campo at-campo-pequeno" value={checkin} min={hoje()}
              onChange={(e) => { setCheckin(e.target.value); if (!checkout || checkout <= e.target.value) setCheckout(somarDias(e.target.value, 1)); setResultado(null); }} />
          </label>
          <label><span>Saída</span>
            <input type="date" className="campo at-campo-pequeno" value={checkout} min={checkin ? somarDias(checkin, 1) : hoje()}
              onChange={(e) => { setCheckout(e.target.value); setResultado(null); }} />
          </label>
          <label><span>Adultos</span>
            <input type="number" className="campo at-campo-pequeno" min={1} max={30} value={adultos} onChange={(e) => { setAdultos(e.target.value); setResultado(null); }} />
          </label>
          <label><span>Crianças</span>
            <input type="number" className="campo at-campo-pequeno" min={0} max={20} value={criancas} onChange={(e) => { setCriancas(e.target.value); setResultado(null); }} />
          </label>
          <label><span>Quartos</span>
            <input type="number" className="campo at-campo-pequeno" min={1} max={10} value={quartos} onChange={(e) => { setQuartos(e.target.value); setResultado(null); }} />
          </label>
          <button type="submit" className="at-btn at-btn-verde" disabled={buscando}>{buscando ? 'Buscando…' : '🔎 Buscar preços'}</button>
        </form>
        {noites > 0 && !resultado && <p className="at-dica">{noites} noite{noites > 1 ? 's' : ''}: {dataBR(checkin)} a {dataBR(checkout)}.</p>}

        {resultado && (
          <>
            {resultado.itens.length === 0 ? (
              <div className="aviso-erro" style={{ background: '#FFF4D6', color: '#7A5600', marginTop: 10 }}>
                Nenhum quarto disponível para {dataBR(resultado.checkin)} a {dataBR(resultado.checkout)} com {Number(adultos) + Number(criancas)} hóspede(s). Tente outras datas.
              </div>
            ) : (
              <div className="ct-quartos">
                {resultado.itens.map((i) => (
                  <label key={i.tipoId} className={`ct-quarto ${escolhidos.includes(i.tipoId) ? 'escolhido' : ''}`}>
                    <input type="checkbox" checked={escolhidos.includes(i.tipoId)} onChange={() => alternar(i.tipoId)} />
                    {i.foto ? <img src={i.foto} alt="" /> : <span className="ct-sem-foto">🛏️</span>}
                    <span className="ct-quarto-meio">
                      <strong>{i.nome}</strong>
                      <small>
                        {i.disponiveis != null ? `${i.disponiveis} ${i.disponiveis === 1 ? 'disponível' : 'disponíveis'}` : ''}
                        {i.capacidade ? ` · até ${i.capacidade} pessoas` : ''}
                      </small>
                    </span>
                    <span className="ct-preco">
                      <strong>{reais(i.total)}</strong>
                      {resultado.noites > 1 && <small>{reais(i.porNoite)} / noite</small>}
                    </span>
                  </label>
                ))}
              </div>
            )}

            {!resultado.motor && (
              <div className="aviso-erro" style={{ marginTop: 10 }}>
                Falta o link do motor de reservas deste hotel. O administrador coloca em “Funil e etiquetas” → “Motor de reservas e cotação”.
              </div>
            )}

            {itensEscolhidos.length > 0 && (
              <>
                <div className="at-canal-topo" style={{ marginTop: 12 }}>
                  <p className="at-lateral-titulo" style={{ margin: 0 }}>Prévia {ehEmail ? 'do e-mail (vai com foto e botão “Reservar agora”)' : 'da mensagem'}</p>
                  <button type="button" className="at-link-pequeno" onClick={() => setEditarTexto(!editarTexto)}>{editarTexto ? 'Fechar edição' : 'Editar abertura e final'}</button>
                </div>
                {editarTexto && (
                  <div className="ct-editar">
                    <label className="rotulo" htmlFor="ct-abertura">Abertura</label>
                    <textarea id="ct-abertura" className="campo at-campo-pequeno" rows={2} value={abertura} onChange={(e) => setAbertura(e.target.value)} />
                    <label className="rotulo" htmlFor="ct-final">Final</label>
                    <textarea id="ct-final" className="campo at-campo-pequeno" rows={3} value={final} onChange={(e) => setFinal(e.target.value)} />
                    <p className="at-dica">Variáveis: {'{nome}'} {'{checkin}'} {'{checkout}'} {'{noites}'} {'{hospedes}'} {'{hotel}'}. Os preços e os links entram sozinhos e não podem ser alterados.</p>
                  </div>
                )}
                <div className="at-previa-modelo ct-previa">{previa}</div>
              </>
            )}
          </>
        )}

        {bloqueadoJanela && (
          <div className="at-aviso-janela" style={{ marginTop: 10 }}>
            ⏰ Passaram 24 horas desde a última mensagem do cliente. Envie primeiro um modelo aprovado do WhatsApp; quando ele responder, mande a cotação.
          </div>
        )}
        {erro && <div className="aviso-erro" style={{ marginTop: 10 }}>{erro}</div>}
        <div className="at-botoes">
          <button type="button" className="at-btn at-btn-verde" onClick={enviar}
            disabled={enviando || !resultado || !itensEscolhidos.length || !resultado.motor || bloqueadoJanela}>
            {enviando ? 'Enviando…' : `Enviar cotação ${ehEmail ? 'por e-mail' : 'no WhatsApp'}`}
          </button>
          <button type="button" className="at-btn" onClick={onFechar}>Cancelar</button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
const STATUS_COTACAO = {
  ENVIADA: ['Enviada', ''],
  CLICOU: ['Clicou em Reservar agora', 'at-chip-pendente'],
  RESERVOU: ['Reservou ✓', 'at-chip-resolvida'],
  CANCELADA: ['Não enviada', 'at-chip-atrasada'],
};

export function ListaCotacoes({ conversa }) {
  const [lista, setLista] = useState(null);

  useEffect(() => {
    let ativo = true;
    supabase.from('atendimento_cotacoes').select('*').eq('conversa_id', conversa.id)
      .order('criado_em', { ascending: false }).limit(10)
      .then(({ data, error }) => { if (ativo) setLista(error ? [] : (data || [])); });
    return () => { ativo = false; };
  }, [conversa.id, conversa.atualizado_em, conversa.etapa_id]);

  if (!lista || !lista.length) return null;
  return (
    <div className="at-lateral-bloco">
      <p className="at-lateral-titulo">Cotações ({lista.length})</p>
      {lista.map((c) => {
        const [rotulo, classe] = STATUS_COTACAO[c.status] || [c.status, ''];
        return (
          <div key={c.id} className="ct-item">
            <div className="at-canal-topo">
              <strong>{dataBR(c.checkin)} a {dataBR(c.checkout)}</strong>
              <span className={`at-chip ${classe}`}>{rotulo}</span>
            </div>
            <small>{c.adultos} adulto(s){c.criancas ? `, ${c.criancas} criança(s)` : ''}{c.quartos > 1 ? `, ${c.quartos} quartos` : ''} · enviada {dataHora(c.criado_em)}</small>
            {(c.itens || []).map((i, n) => (
              <div key={n} className="at-dado"><span>{i.nome}{c.item_clicado === n && c.cliques ? ' 🖱️' : ''}</span><span>{reais(i.total)}</span></div>
            ))}
            {c.cliques > 0 && <small>🖱️ {c.cliques} clique(s) · último {dataHora(c.ultimo_clique_em)}</small>}
            {c.status === 'RESERVOU' && <small>🎉 Reserva {c.reserva_id}{c.reserva_valor ? ` · ${reais(c.reserva_valor)}` : ''}</small>}
          </div>
        );
      })}
    </div>
  );
}
