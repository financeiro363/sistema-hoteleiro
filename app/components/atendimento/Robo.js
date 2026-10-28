'use client';

// ============================================================================
// CAIXA DE ENTRADA — aba "Robô (IA)" (só ADMIN) — Fase 4
// ============================================================================
// - Configuração: ligar/desligar, canais, qual IA, limite de gasto, chave da
//   Anthropic (guardada criptografada, nunca volta para a tela), uso do mês,
//   os dados do hotel lidos da Cloudbeds e o outro hotel do grupo que o robô
//   oferece quando não há quarto aqui
// - Conteúdo: o que o robô sabe do hotel, em assuntos, com rascunho e
//   publicação (as versões publicadas ficam guardadas)
// - Testar: conversa de mentira com o robô, sem enviar nada a cliente
// ============================================================================

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../../../lib/supabaseClient';
import { chamarApi, dataHora } from './util';
import {
  MODELOS_IA, MODELO_PADRAO, CANAIS_ROBO, ASSUNTOS_SUGERIDOS, dolares,
} from '../../../lib/atendimento/roboConfig';

const SEM_SQL = 'Falta rodar no Supabase o SQL da Fase 4 (sql/caixa_de_entrada_fase4.sql).';
const PADRAO = { ligado: false, canais: ['WHATSAPP'], modelo: MODELO_PADRAO, nome_assistente: '', horas_retomar: 12, limite_mensal_usd: 30, email_solicitacoes: '', modo_economico: true, outros_hoteis: [] };

function erroAmigavel(e) {
  const m = String(e?.message || e || '');
  return /atendimento_robo|does not exist|schema cache/i.test(m) ? SEM_SQL : m;
}

// "### Título\ntexto" → [{ titulo, texto }]
export function separarAssuntos(texto) {
  const linhas = String(texto || '').replace(/\r\n/g, '\n').split('\n');
  const lista = [];
  let atual = null;
  for (const linha of linhas) {
    const m = linha.match(/^\s*#{1,4}\s+(.+?)\s*$/);
    if (m) { atual = { titulo: m[1].replace(/\*+/g, '').trim(), texto: '' }; lista.push(atual); continue; }
    if (!atual) { atual = { titulo: 'Informações gerais', texto: '' }; lista.push(atual); }
    atual.texto += `${linha}\n`;
  }
  return lista.map((a) => ({ titulo: a.titulo.slice(0, 120), texto: a.texto.trim() })).filter((a) => a.texto || a.titulo);
}

const juntarAssuntos = (lista) => (lista || []).map((a) => `### ${a.titulo}\n${a.texto}`).join('\n\n');
const iguais = (a, b) => JSON.stringify(a || []) === JSON.stringify(b || []);
// Como o assunto fica gravado (sem espaços sobrando e sem assunto vazio)
export const normalizarAssuntos = (lista) => (Array.isArray(lista) ? lista : [])
  .map((a) => ({ titulo: String(a?.titulo || '').trim().slice(0, 120) || 'Assunto', texto: String(a?.texto || '').trim().slice(0, 8000) }))
  .filter((a) => a.texto || a.titulo !== 'Assunto');
const ESPERA_SALVAR_MS = 1500;

export function RoboIA({ hoteis, hotelAtual, canais, preferencias, onMudou }) {
  const [hotelId, setHotelId] = useState((hoteis.find((h) => h.id === Number(hotelAtual)) || hoteis[0])?.id);
  const [secao, setSecao] = useState('config');
  const [config, setConfig] = useState(null);
  const [form, setForm] = useState(PADRAO);
  const [conteudo, setConteudo] = useState(null);
  const [resumo, setResumo] = useState(null);
  const [erro, setErro] = useState('');
  const [ok, setOk] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [carregando, setCarregando] = useState(true);

  const carregar = useCallback(async () => {
    if (!hotelId) return;
    setCarregando(true);
    const [c, ct, r] = await Promise.all([
      supabase.from('atendimento_robo').select('*').eq('hotel_id', hotelId).maybeSingle(),
      supabase.from('atendimento_robo_conteudo').select('*').eq('hotel_id', hotelId).maybeSingle(),
      supabase.rpc('atendimento_robo_resumo', { p_hotel: hotelId }),
    ]);
    if (c.error) setErro(erroAmigavel(c.error));
    setConfig(c.data || null);
    setForm(c.data ? {
      ligado: c.data.ligado, canais: c.data.canais || [], modelo: c.data.modelo || MODELO_PADRAO, nome_assistente: c.data.nome_assistente || '',
      horas_retomar: c.data.horas_retomar ?? 12, limite_mensal_usd: c.data.limite_mensal_usd ?? 30, email_solicitacoes: c.data.email_solicitacoes || '',
      modo_economico: c.data.modo_economico !== false,
      outros_hoteis: Array.isArray(c.data.outros_hoteis) ? c.data.outros_hoteis : [],
    } : PADRAO);
    // Se não conseguiu ler o conteúdo, avisa e não deixa editar (para não gravar vazio por cima)
    if (ct.error) setErro(`Não foi possível ler o conteúdo do robô: ${erroAmigavel(ct.error)}`);
    setConteudo(ct.error ? { hotel_id: hotelId, rascunho: [], publicado: [], erroLeitura: true } : (ct.data || { hotel_id: hotelId, rascunho: [], publicado: [] }));
    setResumo(r.data || null);
    setCarregando(false);
  }, [hotelId]);

  useEffect(() => { setErro(''); setOk(''); setConteudo(null); carregar(); }, [carregar]);

  const nomeHotel = hoteis.find((h) => h.id === Number(hotelId))?.nome || 'hotel';
  const temWhatsApp = (canais || []).some((c) => c.hotel_id === Number(hotelId) && ['WHATSAPP', 'SITE'].includes(c.tipo) && c.ativo);
  const pref = (preferencias || []).find((p) => p.hotel_id === Number(hotelId));

  return (
    <>
      {hoteis.length > 1 && (
        <div className="at-botoes" style={{ marginTop: 0, marginBottom: 12, alignItems: 'center' }}>
          <label className="at-detalhe" style={{ margin: 0 }}>
            <span style={{ color: 'var(--tinta)', fontWeight: 600 }}>Hotel</span>
            <select className="at-select" value={hotelId} onChange={(e) => setHotelId(Number(e.target.value))}>
              {hoteis.map((h) => <option key={h.id} value={h.id}>{h.nome}</option>)}
            </select>
          </label>
          <span className="at-dica" style={{ margin: 0 }}>Cada hotel tem o seu robô, o seu conteúdo e a sua chave.</span>
        </div>
      )}
      <div className="at-filtros" style={{ marginBottom: 12 }}>
        {[['config', '⚙️ Configuração'], ['conteudo', '📚 Conteúdo'], ['testar', '💬 Testar o robô']].map(([k, r]) => (
          <button key={k} type="button" className={`at-filtro ${secao === k ? 'ativo' : ''}`} onClick={() => { setSecao(k); setErro(''); setOk(''); }}>{r}</button>
        ))}
      </div>
      {erro && <div className="aviso-erro">{erro}</div>}
      {ok && <div className="aviso-erro" style={{ background: '#E5F4EA', color: '#14532D' }}>{ok}</div>}
      {carregando && !conteudo ? <div className="at-vazio">Carregando…</div> : (
        <>
          {secao === 'config' && (
            <Configuracao
              hotelId={hotelId} nomeHotel={nomeHotel} config={config} form={form} setForm={setForm} resumo={resumo} conteudo={conteudo}
              temWhatsApp={temWhatsApp} motor={pref?.motor_url} ocupado={ocupado} setOcupado={setOcupado}
              setErro={setErro} setOk={setOk} onMudou={async () => { await carregar(); onMudou?.(); }} irPara={setSecao}
            />
          )}
          {secao === 'conteudo' && (
            <Conteudo key={`c-${hotelId}`} hotelId={hotelId} nomeHotel={nomeHotel} conteudo={conteudo} setErro={setErro} setOk={setOk} onMudou={carregar}
              onRascunhoSalvo={(rascunho) => setConteudo((c) => (c && Number(c.hotel_id) === Number(hotelId) ? { ...c, rascunho, rascunho_em: new Date().toISOString() } : c))} />
          )}
          {secao === 'testar' && (
            <Testar key={`t-${hotelId}`} hotelId={hotelId} nomeHotel={nomeHotel} config={config} conteudo={conteudo} setErro={setErro} />
          )}
        </>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Sem quarto aqui: outro hotel do grupo que o robô oferece (e a equipe pode cotar)
function OutroHotel({ hotelId, nomeHotel, form, setForm, ocupado, onSalvar, versao }) {
  const [lista, setLista] = useState(null);
  const [sqlPronto, setSqlPronto] = useState(true);
  const [erro, setErro] = useState('');

  useEffect(() => {
    let ativo = true;
    chamarApi('/api/atendimento', { acao: 'robo_hoteis_grupo', hotelId })
      .then((r) => { if (ativo) { setLista(r.hoteis || []); setSqlPronto(r.sqlPronto !== false); } })
      .catch((e) => { if (ativo) { setLista([]); setErro(e.message); } });
    return () => { ativo = false; };
  }, [hotelId, versao]);

  const escolhidos = form.outros_hoteis || [];
  const achar = (id) => escolhidos.find((o) => Number(o.hotel_id) === Number(id));
  const marcar = (id, sim) => setForm({
    ...form,
    outros_hoteis: sim ? [...escolhidos.filter((o) => Number(o.hotel_id) !== Number(id)), { hotel_id: id, descricao: '' }]
      : escolhidos.filter((o) => Number(o.hotel_id) !== Number(id)),
  });
  const descrever = (id, descricao) => setForm({
    ...form, outros_hoteis: escolhidos.map((o) => (Number(o.hotel_id) === Number(id) ? { ...o, descricao } : o)),
  });
  const exemplo = lista?.find((h) => achar(h.id))?.nome || lista?.[0]?.nome || 'Guarany Hotel';
  const descricaoExemplo = lista?.map((h) => achar(h.id)?.descricao).find(Boolean);

  return (
    <section className="at-cartao">
      <h2>🏨 Sem quarto aqui: oferecer outro hotel do grupo</h2>
      <p className="at-dica" style={{ marginTop: 0 }}>
        Quando não houver quarto em {nomeHotel} nas datas pedidas, o robô consulta o hotel marcado e já manda a cotação dele na mesma mensagem.
        A conversa continua aqui; se o cliente reservar lá, ela vai para “Reservou”. A equipe também pode cotar esse hotel na tela de cotação.
      </p>
      {lista === null ? <p className="at-dica">Carregando…</p> : (
        <>
          {!lista.length && <p className="at-dica">Nenhum outro hotel em que você também seja administrador.</p>}
          <div style={{ display: 'grid', gap: 8, maxWidth: 720 }}>
            {lista.map((h) => {
              const o = achar(h.id);
              return (
                <div key={h.id} className="at-reserva" style={{ margin: 0 }}>
                  <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start', cursor: 'pointer' }}>
                    <input type="checkbox" checked={!!o} onChange={(e) => marcar(h.id, e.target.checked)} style={{ marginTop: 4 }} />
                    <span>
                      <strong>{h.nome}</strong>
                      {!h.cloudbeds && <span className="at-ruim" style={{ display: 'block' }}>✗ Este hotel não tem a Cloudbeds ligada no sistema: o robô não consegue consultar.</span>}
                      {h.cloudbeds && !h.motor && <span className="at-dica" style={{ display: 'block', margin: 0 }}>O link do motor de reservas dele é descoberto sozinho na primeira cotação.</span>}
                    </span>
                  </label>
                  {o && (
                    <div style={{ marginTop: 8, paddingLeft: 26 }}>
                      <label className="rotulo" htmlFor={`rb-outro-${h.id}`}>Frase curta sobre ele (opcional)</label>
                      <input id={`rb-outro-${h.id}`} className="campo" maxLength={120} value={o.descricao || ''}
                        onChange={(e) => descrever(h.id, e.target.value)} placeholder="Ex.: também no Centro, a 1 km daqui" />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          {lista.length > 0 && (
            <div className="at-previa-modelo" style={{ marginTop: 10, maxWidth: 720 }}>
              Olá, Maria! Para 10/12/2026 a 12/12/2026 (2 noites), 2 adultos, não temos mais quarto no {nomeHotel}, mas o *{exemplo}*, do mesmo grupo{descricaoExemplo ? ` (${descricaoExemplo})` : ''}, tem estas opções:
            </div>
          )}
          {!sqlPronto && <div className="aviso-erro" style={{ marginTop: 10 }}>Para usar, primeiro rode no Supabase o SQL sql/robo_outro_hotel.sql.</div>}
          {erro && <div className="aviso-erro" style={{ marginTop: 10 }}>{erro}</div>}
          {lista.length > 0 && (
            <div className="at-botoes">
              <button type="button" className="at-btn at-btn-verde" onClick={onSalvar} disabled={ocupado}>Salvar</button>
            </div>
          )}
        </>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
function Item({ ok: certo, children }) {
  return <div className="at-dado"><span>{children}</span><span className={certo ? 'at-ok' : 'at-ruim'}>{certo ? '✓ Pronto' : '✗ Falta'}</span></div>;
}

function Configuracao({
  hotelId, nomeHotel, config, form, setForm, resumo, conteudo, temWhatsApp, motor, ocupado, setOcupado, setErro, setOk, onMudou, irPara,
}) {
  const [chave, setChave] = useState('');
  const [mostrarInfo, setMostrarInfo] = useState(false);
  const temChave = !!config?.chave_salva_em;
  const publicado = Array.isArray(conteudo?.publicado) && conteudo.publicado.length > 0;
  const info = config?.hotel_info;
  const gasto = Number(resumo?.gasto_mes || 0);
  const limite = Number(form.limite_mensal_usd || 0);

  async function executar(acao, mensagem) {
    setOcupado(true); setErro(''); setOk('');
    try { await acao(); if (mensagem) setOk(mensagem); await onMudou(); }
    catch (e) { setErro(erroAmigavel(e)); }
    setOcupado(false);
  }

  const salvar = (extra = {}) => executar(async () => {
    await chamarApi('/api/atendimento', { acao: 'robo_config', hotelId, config: { ...form, ...extra } });
  }, extra.ligado === true ? `🤖 Robô ligado para ${nomeHotel}.` : extra.ligado === false ? 'Robô desligado.' : 'Configuração salva.');

  const guardarChave = () => executar(async () => {
    await chamarApi('/api/atendimento', { acao: 'robo_chave', hotelId, chave: chave.trim() });
    setChave('');
  }, 'Chave testada e guardada (criptografada). Ela não aparece mais na tela.');

  const testarGuardada = () => executar(async () => {
    await chamarApi('/api/atendimento', { acao: 'robo_chave', hotelId });
  }, 'A chave guardada está funcionando.');

  const apagarChave = () => {
    if (!window.confirm('Apagar a chave da Anthropic deste hotel? O robô será desligado.')) return;
    executar(async () => { await chamarApi('/api/atendimento', { acao: 'robo_chave', hotelId, apagar: true }); }, 'Chave apagada e robô desligado.');
  };

  const lerCloudbeds = () => executar(async () => {
    await chamarApi('/api/atendimento', { acao: 'robo_info_hotel', hotelId });
    setMostrarInfo(true);
  }, 'Dados do hotel lidos da Cloudbeds.');

  const marcarCanal = (tipo, marcado) => setForm({ ...form, canais: marcado ? [...new Set([...(form.canais || []), tipo])] : (form.canais || []).filter((t) => t !== tipo) });

  return (
    <>
      <section className="at-cartao">
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
          <div>
            <h2>{config?.ligado ? '🟢 Robô ligado' : '⚪ Robô desligado'}</h2>
            <p className="at-dica" style={{ margin: 0 }}>
              {config?.ligado
                ? `Responde os clientes de ${nomeHotel} 24 horas, até alguém da equipe assumir a conversa.`
                : 'Enquanto estiver desligado, nenhum cliente recebe resposta do robô. Use “Testar o robô” à vontade.'}
            </p>
          </div>
          {config?.ligado
            ? <button type="button" className="at-btn at-btn-perigo" onClick={() => salvar({ ligado: false })} disabled={ocupado}>Desligar o robô</button>
            : <button type="button" className="at-btn at-btn-verde" onClick={() => salvar({ ligado: true })} disabled={ocupado || !temChave || !publicado}>Ligar o robô</button>}
        </div>
        <div style={{ marginTop: 12, maxWidth: 560 }}>
          <Item ok={temChave}>Chave da Anthropic guardada</Item>
          <Item ok={publicado}>Conteúdo do hotel publicado {!publicado && <button type="button" className="at-link-pequeno" onClick={() => irPara('conteudo')}>escrever</button>}</Item>
          <Item ok={!!motor}>Link do motor de reservas (para a cotação)</Item>
          <Item ok={temWhatsApp}>WhatsApp ou chat do site ligado neste hotel</Item>
        </div>
        {!temWhatsApp && <p className="at-dica">Sem o WhatsApp ou o chat do site ligados, o robô fica pronto, mas só vai responder quando um deles for ligado ao sistema.</p>}
      </section>

      <section className="at-cartao">
        <h2>🔑 Chave da Anthropic (a empresa da IA)</h2>
        <p className="at-dica" style={{ marginTop: 0 }}>
          {temChave ? <>Chave guardada em {dataHora(config.chave_salva_em)}. Por segurança, ela nunca volta para a tela.</> : 'Nenhuma chave guardada ainda.'}
        </p>
        <details style={{ marginBottom: 10 }}>
          <summary style={{ cursor: 'pointer', fontWeight: 600 }}>Como conseguir a chave</summary>
          <ol className="at-dica" style={{ paddingLeft: 18 }}>
            <li>Entre em <a href="https://platform.claude.com" target="_blank" rel="noreferrer">platform.claude.com</a> e crie a conta do hotel (ou entre na que já existe).</li>
            <li>Em <strong>Billing</strong>, cadastre o cartão e compre crédito (por exemplo, US$ 10). O gasto sai desse crédito.</li>
            <li>Em <strong>Settings → Limits</strong>, se quiser, coloque um limite de gasto por mês (uma segunda trava, além da daqui).</li>
            <li>Em <strong>Settings → API keys</strong>, clique em <strong>Create key</strong>, dê o nome “Chokmah — {nomeHotel}”, escolha o workspace <strong>Default</strong> e a validade <strong>Never</strong> (nunca expira).</li>
            <li>Copie a chave (começa com <code>sk-ant-</code>; ela só aparece uma vez) e cole aqui embaixo. Não mande a chave por e-mail nem por mensagem.</li>
          </ol>
        </details>
        <label className="rotulo" htmlFor="rb-chave">{temChave ? 'Trocar a chave' : 'Colar a chave'}</label>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <input id="rb-chave" className="campo" style={{ flex: '1 1 320px' }} type="password" autoComplete="off" value={chave}
            onChange={(e) => setChave(e.target.value)} placeholder="sk-ant-…" />
          <button type="button" className="at-btn at-btn-verde" onClick={guardarChave} disabled={ocupado || !chave.trim()}>Testar e guardar</button>
        </div>
        {temChave && (
          <div className="at-botoes">
            <button type="button" className="at-btn" onClick={testarGuardada} disabled={ocupado}>Testar a chave guardada</button>
            <button type="button" className="at-btn at-btn-perigo" onClick={apagarChave} disabled={ocupado}>Apagar a chave</button>
          </div>
        )}
      </section>

      <section className="at-cartao">
        <h2>⚙️ Como o robô trabalha</h2>
        <label className="rotulo">Canais em que o robô responde</label>
        <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
          {CANAIS_ROBO.map((c) => (
            <label key={c.tipo} className="at-detalhe" style={{ margin: 0, opacity: c.pronto ? 1 : 0.55 }}>
              <input type="checkbox" disabled={!c.pronto} checked={(form.canais || []).includes(c.tipo)} onChange={(e) => marcarCanal(c.tipo, e.target.checked)} />
              <span style={{ color: 'var(--tinta)', fontWeight: 600 }}>{c.nome}{c.pronto ? '' : ' (em breve)'}</span>
            </label>
          ))}
        </div>
        <p className="at-dica">No e-mail o robô não responde: muitos e-mails são de fornecedores, sistemas e agências.</p>

        <label className="rotulo">Qual IA</label>
        <div style={{ display: 'grid', gap: 8 }}>
          {Object.entries(MODELOS_IA).map(([id, m]) => (
            <label key={id} className="at-reserva" style={{ display: 'flex', gap: 10, alignItems: 'flex-start', cursor: 'pointer', margin: 0 }}>
              <input type="radio" name="rb-modelo" checked={form.modelo === id} onChange={() => setForm({ ...form, modelo: id })} style={{ marginTop: 4 }} />
              <span>
                <strong>{m.nome}</strong>
                <span className="at-dica" style={{ display: 'block', margin: 0 }}>{m.resumo} Estimativa para ~1.500 conversas/mês: {id === MODELO_PADRAO ? 'US$ 10 a 15' : 'US$ 150 a 250'}.</span>
              </span>
            </label>
          ))}
        </div>

        <label className="at-reserva" style={{ display: 'flex', gap: 10, alignItems: 'flex-start', cursor: 'pointer', margin: '10px 0 0' }}>
          <input type="checkbox" checked={form.modo_economico !== false} onChange={(e) => setForm({ ...form, modo_economico: e.target.checked })} style={{ marginTop: 4 }} />
          <span>
            <strong>💸 Modo econômico (recomendado)</strong>
            <span className="at-dica" style={{ display: 'block', margin: 0 }}>O robô responde tudo numa mensagem só, com a cotação junto, e não manda “vou verificar…” separado. Desde 1º/10/2026 a Meta cobra cada mensagem enviada depois das 1.000 grátis do mês.</span>
          </span>
        </label>

        <div className="at-grade" style={{ marginTop: 6 }}>
          <div>
            <label className="rotulo" htmlFor="rb-nome">Nome do assistente (opcional)</label>
            <input id="rb-nome" className="campo" maxLength={40} value={form.nome_assistente} onChange={(e) => setForm({ ...form, nome_assistente: e.target.value })} placeholder={`Assistente virtual do ${nomeHotel}`} />
          </div>
          <div>
            <label className="rotulo" htmlFor="rb-horas">Depois que alguém assume, o robô volta a responder após (horas sem a equipe escrever)</label>
            <input id="rb-horas" className="campo" type="number" min={1} max={168} value={form.horas_retomar} onChange={(e) => setForm({ ...form, horas_retomar: e.target.value })} />
          </div>
          <div>
            <label className="rotulo" htmlFor="rb-limite">Limite de gasto por mês (US$)</label>
            <input id="rb-limite" className="campo" type="number" min={0} max={5000} step="1" value={form.limite_mensal_usd} onChange={(e) => setForm({ ...form, limite_mensal_usd: e.target.value })} />
          </div>
          <div>
            <label className="rotulo" htmlFor="rb-email">Avisar as solicitações também por e-mail (opcional)</label>
            <input id="rb-email" className="campo" type="email" value={form.email_solicitacoes} onChange={(e) => setForm({ ...form, email_solicitacoes: e.target.value })} placeholder="reservas@seuhotel.com.br" />
          </div>
        </div>
        <p className="at-dica">O robô também volta a responder quando a conversa é marcada como resolvida ou arquivada. Ao chegar no limite do mês, o robô para e a equipe assume (o cliente recebe “Nossa equipe vai te responder”). O e-mail de aviso sai pela caixa de e-mail ligada do hotel.</p>
        <div className="at-botoes">
          <button type="button" className="at-btn at-btn-verde" onClick={() => salvar()} disabled={ocupado}>Salvar</button>
        </div>
      </section>

      <OutroHotel hotelId={hotelId} nomeHotel={nomeHotel} form={form} setForm={setForm} ocupado={ocupado} onSalvar={() => salvar()} versao={config?.atualizado_em} />

      <section className="at-cartao">
        <h2>💵 Uso neste mês</h2>
        <div style={{ maxWidth: 520 }}>
          <div className="at-dado"><span>Gasto estimado</span><span>{dolares(gasto, 2)}{limite > 0 ? ` de ${dolares(limite, 0)}` : ''}</span></div>
          {limite > 0 && (
            <div style={{ height: 8, background: '#ECEEEA', borderRadius: 99, overflow: 'hidden', margin: '4px 0 8px' }} aria-hidden="true">
              <div style={{ width: `${Math.min(100, (gasto / limite) * 100)}%`, height: '100%', background: gasto >= limite ? '#B42318' : '#2a78d6' }} />
            </div>
          )}
          <div className="at-dado"><span>Conversas atendidas pelo robô</span><span>{resumo?.conversas_mes ?? 0}</span></div>
          <div className="at-dado"><span>Respostas enviadas</span><span>{resumo?.respostas_mes ?? 0}</span></div>
          <div className="at-dado"><span>Gasto com testes</span><span>{dolares(resumo?.gasto_testes || 0, 3)}</span></div>
        </div>
        <p className="at-dica">É uma estimativa feita pelo sistema com a tabela de preços da Anthropic. O valor cobrado de verdade aparece no console da Anthropic, em Billing (em dólar, no cartão).</p>
      </section>

      <section className="at-cartao">
        <h2>🏨 Dados do hotel na Cloudbeds</h2>
        <p className="at-dica" style={{ marginTop: 0 }}>
          Além do conteúdo escrito por vocês, o robô usa da Cloudbeds o endereço, os horários de check-in e check-out e os tipos de quarto.
          {config?.hotel_info_em ? ` Última leitura: ${dataHora(config.hotel_info_em)} (atualiza sozinho toda semana).` : ' Ainda não foram lidos.'}
        </p>
        <div className="at-botoes">
          <button type="button" className="at-btn" onClick={lerCloudbeds} disabled={ocupado}>🔄 Ler agora da Cloudbeds</button>
          {info && <button type="button" className="at-btn" onClick={() => setMostrarInfo(!mostrarInfo)}>{mostrarInfo ? 'Esconder' : 'Ver o que foi lido'}</button>}
        </div>
        {mostrarInfo && info && (
          <div style={{ marginTop: 10, maxWidth: 720 }}>
            {[['Nome', info.nome], ['Endereço', info.endereco], ['Telefone', info.telefone], ['E-mail', info.email], ['Check-in', info.checkin], ['Check-out', info.checkout]]
              .map(([r, v]) => <div key={r} className="at-dado"><span>{r}</span><span>{v || '—'}</span></div>)}
            <div className="at-dado"><span>Tipos de quarto</span><span>{(info.quartos || []).map((q) => `${q.nome}${q.capacidade ? ` (${q.capacidade})` : ''}`).join(', ') || '—'}</span></div>
            {(info.erroHotel || info.erroQuartos) && <p className="at-dica">Aviso da Cloudbeds: {info.erroHotel || info.erroQuartos}</p>}
          </div>
        )}
      </section>
    </>
  );
}

// ---------------------------------------------------------------------------
function Conteudo({ hotelId, nomeHotel, conteudo, setErro, setOk, onMudou, onRascunhoSalvo }) {
  const [assuntos, setAssuntos] = useState(() => (Array.isArray(conteudo?.rascunho) && conteudo.rascunho.length ? conteudo.rascunho : conteudo?.publicado || []));
  const [ocupado, setOcupado] = useState(false);
  const [colar, setColar] = useState(null);
  const [versoes, setVersoes] = useState(null);
  const [aberto, setAberto] = useState(null);
  const [lacunas, setLacunas] = useState(null); // perguntas que o robô não soube

  useEffect(() => {
    let ativo = true;
    supabase.from('atendimento_robo_lacunas').select('id, pergunta, conversa_id, criado_em')
      .eq('hotel_id', Number(hotelId)).eq('situacao', 'NOVA').order('criado_em', { ascending: false }).limit(50)
      .then(({ data, error }) => { if (ativo) setLacunas(error ? null : data || []); });
    return () => { ativo = false; };
  }, [hotelId]);

  async function marcarLacuna(l, situacao) {
    const { data: sessao } = await supabase.auth.getSession();
    const { data: eu } = await supabase.from('usuarios').select('id').eq('auth_id', sessao?.session?.user?.id).maybeSingle();
    const { error } = await supabase.from('atendimento_robo_lacunas')
      .update({ situacao, resolvida_em: new Date().toISOString(), resolvida_por_id: eu?.id || null }).eq('id', l.id);
    if (error) { setErro(erroAmigavel(error)); return false; }
    setLacunas((lista) => (lista || []).filter((x) => x.id !== l.id));
    return true;
  }

  async function responderLacuna(l) {
    if (!(await marcarLacuna(l, 'RESOLVIDA'))) return;
    const titulo = String(l.pergunta || '').replace(/[?？]+\s*$/, '').trim().slice(0, 80) || 'Novo assunto';
    adicionar(titulo);
    setOk(`Assunto “${titulo}” criado no fim da lista. Escreva a resposta, salve o rascunho e publique.`);
  }

  // O rascunho é salvo sozinho (1,5 s depois de mexer, e na hora ao sair desta
  // aba): trocar para "Testar o robô" ou fechar a página não perde nada.
  const [salvo, setSalvo] = useState(() => normalizarAssuntos(Array.isArray(conteudo?.rascunho) && conteudo.rascunho.length ? conteudo.rascunho : conteudo?.publicado || []));
  const [salvando, setSalvando] = useState(false);
  const [salvoEm, setSalvoEm] = useState(null);
  const [erroSalvar, setErroSalvar] = useState('');
  const assuntosRef = useRef(assuntos);
  assuntosRef.current = assuntos;
  const salvoRef = useRef(salvo);
  salvoRef.current = salvo;
  const bloqueado = !!conteudo?.erroLeitura;
  const atuais = useMemo(() => normalizarAssuntos(assuntos), [assuntos]);
  const mudouDoSalvo = !iguais(atuais, salvo);
  const diferenteDoPublicado = !iguais(atuais, normalizarAssuntos(conteudo?.publicado));

  async function gravar(limpa) {
    const { data: sessao } = await supabase.auth.getSession();
    const { data: eu } = await supabase.from('usuarios').select('id').eq('auth_id', sessao?.session?.user?.id).maybeSingle();
    const { error } = await supabase.from('atendimento_robo_conteudo').upsert({
      hotel_id: Number(hotelId), rascunho: limpa, rascunho_em: new Date().toISOString(), rascunho_por_id: eu?.id || null,
    }, { onConflict: 'hotel_id' });
    if (error) throw error;
    setSalvo(limpa);
    salvoRef.current = limpa;
    setSalvoEm(new Date());
    setErroSalvar('');
    onRascunhoSalvo?.(limpa); // a tela do robô fica com o rascunho certo (ao voltar para esta aba)
  }

  async function salvarSozinho() {
    if (bloqueado) return;
    const limpa = normalizarAssuntos(assuntosRef.current);
    if (iguais(limpa, salvoRef.current)) return;
    setSalvando(true);
    try { await gravar(limpa); } catch (e) { setErroSalvar(`O rascunho não foi salvo: ${erroAmigavel(e)}`); }
    setSalvando(false);
  }

  useEffect(() => {
    if (bloqueado || !mudouDoSalvo) return undefined;
    const id = setTimeout(salvarSozinho, ESPERA_SALVAR_MS);
    return () => clearTimeout(id);
  }, [atuais, salvo, bloqueado]); // eslint-disable-line react-hooks/exhaustive-deps

  // Saiu da aba Conteúdo (ou trocou de hotel): salva na hora o que faltava
  useEffect(() => () => { salvarSozinho(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Fechar a página com alteração ainda não salva: o navegador pergunta antes
  useEffect(() => {
    if (!mudouDoSalvo) return undefined;
    const avisar = (e) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', avisar);
    return () => window.removeEventListener('beforeunload', avisar);
  }, [mudouDoSalvo]);
  const caracteres = useMemo(() => assuntos.reduce((s, a) => s + a.titulo.length + a.texto.length, 0), [assuntos]);
  const faltam = ASSUNTOS_SUGERIDOS.filter(([t]) => !assuntos.some((a) => a.titulo.trim().toLowerCase() === t.toLowerCase()));

  async function salvarRascunho(lista = assuntos, mensagem = 'Rascunho salvo. Ele só vale para os clientes depois de publicar.') {
    if (bloqueado) throw new Error('O conteúdo não foi lido direito. Recarregue a página antes de salvar.');
    const limpa = normalizarAssuntos(lista);
    await gravar(limpa);
    setAssuntos(limpa);
    if (mensagem) setOk(mensagem);
  }

  async function executar(acao) {
    setOcupado(true); setErro(''); setOk('');
    try { await acao(); await onMudou(); } catch (e) { setErro(erroAmigavel(e)); }
    setOcupado(false);
  }

  const publicar = () => {
    if (!window.confirm(`Publicar este conteúdo? A partir de agora o robô de ${nomeHotel} responde com ele.`)) return;
    executar(async () => {
      await salvarRascunho(assuntos, null);
      const { error } = await supabase.rpc('atendimento_robo_publicar', { p_hotel: Number(hotelId) });
      if (error) throw error;
      setOk('Conteúdo publicado. O robô já usa a versão nova.');
    });
  };

  const descartar = () => {
    if (!window.confirm('Descartar as alterações e voltar ao conteúdo publicado?')) return;
    executar(async () => { await salvarRascunho(conteudo?.publicado || [], 'Alterações descartadas.'); });
  };

  async function verVersoes() {
    const { data, error } = await supabase.from('atendimento_robo_versoes').select('*').eq('hotel_id', Number(hotelId)).order('publicado_em', { ascending: false }).limit(15);
    if (error) { setErro(erroAmigavel(error)); return; }
    setVersoes(data || []);
  }

  const mover = (i, d) => {
    const j = i + d;
    if (j < 0 || j >= assuntos.length) return;
    const nova = [...assuntos];
    [nova[i], nova[j]] = [nova[j], nova[i]];
    setAssuntos(nova);
  };
  const alterar = (i, campos) => setAssuntos(assuntos.map((a, k) => (k === i ? { ...a, ...campos } : a)));
  const adicionar = (titulo = 'Novo assunto') => { setAssuntos([...assuntos, { titulo, texto: '' }]); setAberto(assuntos.length); };

  function aplicarColado(modo) {
    const novos = separarAssuntos(colar);
    if (!novos.length) { setErro('Não achei nenhum texto para importar.'); return; }
    const lista = modo === 'trocar' ? novos : [...assuntos, ...novos];
    setColar(null);
    // Já salva o rascunho na hora (não depende de clicar em "Salvar rascunho")
    executar(async () => {
      await salvarRascunho(lista, null);
      setOk(`${novos.length} assunto(s) importado(s) e salvos no rascunho. Confira e clique em “🚀 Publicar” para o robô começar a usar.`);
    });
  }

  return (
    <>
      <section className="at-cartao">
        <h2>📚 O que o robô sabe sobre {nomeHotel}</h2>
        <p className="at-dica" style={{ marginTop: 0 }}>
          Escreva como se estivesse explicando para uma recepcionista nova. O robô só responde com o que estiver aqui (e com os dados da Cloudbeds); o que não estiver, ele passa para a equipe.
          Preços de diária não precisam estar aqui: o robô consulta na hora, na Cloudbeds.
        </p>
        <div className="at-dado" style={{ maxWidth: 620 }}>
          <span>Publicado</span>
          <span>{conteudo?.publicado_em ? `${dataHora(conteudo.publicado_em)} · ${(conteudo.publicado || []).length} assunto(s)` : 'ainda não'}</span>
        </div>
        <div className="at-dado" style={{ maxWidth: 620 }}>
          <span>Rascunho</span>
          <span>
            {salvando ? '💾 salvando…' : mudouDoSalvo ? '✏️ salvando em instantes…'
              : diferenteDoPublicado ? `💾 salvo${salvoEm ? ` às ${salvoEm.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}` : ''}, ainda não publicado`
                : 'igual ao publicado'}
          </span>
        </div>
        {erroSalvar && <div className="aviso-erro" style={{ marginTop: 8 }}>{erroSalvar}</div>}
        {bloqueado && <div className="aviso-erro" style={{ marginTop: 8 }}>Não foi possível ler o conteúdo guardado. Recarregue a página; enquanto isso, nada é salvo (para não apagar o que já existe).</div>}
        {atuais.length > 0 && diferenteDoPublicado && !bloqueado && (
          <div className="aviso-erro" style={{ marginTop: 8, background: '#FFF4D6', color: '#7A5600' }}>
            ⚠️ <strong>O robô ainda não usa este texto.</strong> Ele está guardado como rascunho. Para os clientes receberem estas respostas, clique em <strong>🚀 Publicar</strong>.
          </div>
        )}
        <div className="at-botoes">
          <button type="button" className="at-btn" onClick={() => executar(() => salvarRascunho())} disabled={ocupado || bloqueado || !mudouDoSalvo}>💾 Salvar rascunho</button>
          <button type="button" className="at-btn at-btn-verde" onClick={publicar} disabled={ocupado || bloqueado || !atuais.length || !diferenteDoPublicado}>🚀 Publicar</button>
          {conteudo?.publicado_em && diferenteDoPublicado && <button type="button" className="at-btn" onClick={descartar} disabled={ocupado}>Descartar alterações</button>}
          <button type="button" className="at-btn" onClick={() => setColar('')}>📋 Colar texto pronto</button>
          <button type="button" className="at-btn" onClick={versoes ? () => setVersoes(null) : verVersoes}>{versoes ? 'Esconder versões' : '🕘 Versões publicadas'}</button>
        </div>
        <p className="at-dica">{assuntos.length} assunto(s) · {caracteres.toLocaleString('pt-BR')} caracteres{caracteres > 40000 ? ' — está grande; textos muito longos deixam o robô mais caro e mais lento.' : ''}</p>
      </section>

      {lacunas && lacunas.length > 0 && (
        <section className="at-cartao">
          <h2>❓ Perguntas que o robô não soube ({lacunas.length})</h2>
          <p className="at-dica" style={{ marginTop: 0 }}>O robô passou estas conversas para a equipe porque a resposta não estava no conteúdo. Responda aqui uma vez e, depois de publicar, ele passa a saber.</p>
          {lacunas.map((l) => (
            <div key={l.id} className="at-linha-config">
              <span style={{ flex: 1 }}>
                “{l.pergunta}”
                <span className="at-dica" style={{ display: 'block', margin: 0 }}>{dataHora(l.criado_em)}{l.conversa_id ? <> · <a href={`/atendimento?conversa=${l.conversa_id}`}>ver conversa</a></> : null}</span>
              </span>
              <button type="button" className="at-btn at-btn-verde" onClick={() => responderLacuna(l)}>✍️ Responder no conteúdo</button>
              <button type="button" className="at-btn" onClick={() => marcarLacuna(l, 'IGNORADA')}>Ignorar</button>
            </div>
          ))}
        </section>
      )}

      {versoes && (
        <section className="at-cartao">
          <h2>🕘 Versões publicadas</h2>
          {versoes.length === 0 ? <p className="at-dica">Nenhuma versão publicada ainda.</p> : versoes.map((v) => (
            <div key={v.id} className="at-linha-config">
              <span style={{ flex: 1 }}>{dataHora(v.publicado_em)} · {(v.conteudo || []).length} assunto(s)</span>
              <button type="button" className="at-btn" onClick={() => { setAssuntos(v.conteudo || []); setVersoes(null); setOk('Versão copiada para o rascunho. Salve e publique se quiser voltar a ela.'); }}>Copiar para o rascunho</button>
            </div>
          ))}
        </section>
      )}

      {colar !== null && (
        <section className="at-cartao">
          <h2>📋 Colar texto pronto</h2>
          <p className="at-dica" style={{ marginTop: 0 }}>Cole o texto (por exemplo, o conteúdo copiado do Asksuite). Cada linha que começa com <code>###</code> vira um assunto novo; o resto vira o texto do assunto.</p>
          <textarea className="campo" rows={12} value={colar} onChange={(e) => setColar(e.target.value)} placeholder={'### Café da manhã\nServido das 6h às 10h, incluso na diária.\n\n### Estacionamento\n…'} />
          <div className="at-botoes">
            <button type="button" className="at-btn at-btn-verde" onClick={() => aplicarColado('somar')} disabled={!colar.trim()}>Adicionar aos assuntos</button>
            <button type="button" className="at-btn" onClick={() => { if (window.confirm('Trocar todos os assuntos do rascunho por este texto?')) aplicarColado('trocar'); }} disabled={!colar.trim()}>Trocar tudo por este texto</button>
            <button type="button" className="at-btn" onClick={() => setColar(null)}>Cancelar</button>
          </div>
        </section>
      )}

      <section className="at-cartao">
        <h2>Assuntos</h2>
        {assuntos.length === 0 && <p className="at-dica">Nenhum assunto ainda. Comece pelos sugeridos abaixo ou cole um texto pronto.</p>}
        {assuntos.map((a, i) => (
          <div key={i} className="at-reserva">
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <input className="campo" style={{ flex: '1 1 220px', margin: 0, fontWeight: 600 }} value={a.titulo} onChange={(e) => alterar(i, { titulo: e.target.value })} aria-label="Título do assunto" />
              <button type="button" className="at-btn" onClick={() => setAberto(aberto === i ? null : i)}>{aberto === i ? 'Fechar' : 'Editar'}</button>
              <button type="button" className="at-btn" onClick={() => mover(i, -1)} disabled={i === 0} aria-label="Subir">↑</button>
              <button type="button" className="at-btn" onClick={() => mover(i, 1)} disabled={i === assuntos.length - 1} aria-label="Descer">↓</button>
              <button type="button" className="at-btn at-btn-perigo" onClick={() => { if (window.confirm(`Apagar o assunto “${a.titulo}”?`)) setAssuntos(assuntos.filter((_, k) => k !== i)); }} aria-label="Apagar">🗑</button>
            </div>
            {aberto === i ? (
              <textarea className="campo" rows={8} style={{ marginTop: 8 }} value={a.texto} onChange={(e) => alterar(i, { texto: e.target.value })}
                placeholder={ASSUNTOS_SUGERIDOS.find(([t]) => t === a.titulo)?.[1] || 'Escreva aqui…'} />
            ) : (
              <p className="at-dica" style={{ margin: '6px 0 0', whiteSpace: 'pre-wrap' }}>{a.texto ? (a.texto.length > 220 ? `${a.texto.slice(0, 220)}…` : a.texto) : '(vazio)'}</p>
            )}
          </div>
        ))}
        <div className="at-botoes">
          <button type="button" className="at-btn" onClick={() => adicionar()}>+ Novo assunto</button>
        </div>
        {faltam.length > 0 && (
          <>
            <p className="at-dica" style={{ marginBottom: 4 }}>Sugestões de assunto (clique para adicionar):</p>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {faltam.map(([t, dica]) => <button key={t} type="button" className="at-filtro" title={dica} onClick={() => adicionar(t)}>+ {t}</button>)}
            </div>
          </>
        )}
      </section>
    </>
  );
}

// ---------------------------------------------------------------------------
function Testar({ hotelId, nomeHotel, config, conteudo }) {
  const [mensagens, setMensagens] = useState([]); // { papel: cliente | robo | acao | cotacao | erro, texto }
  const [texto, setTexto] = useState('');
  const [usarRascunho, setUsarRascunho] = useState(true);
  const [pensando, setPensando] = useState(false);
  const [custo, setCusto] = useState(0);
  const fimRef = useRef(null);
  const temChave = !!config?.chave_salva_em;
  const temRascunho = Array.isArray(conteudo?.rascunho) && conteudo.rascunho.length > 0;
  const temPublicado = Array.isArray(conteudo?.publicado) && conteudo.publicado.length > 0;

  useEffect(() => { fimRef.current?.scrollIntoView({ block: 'end' }); }, [mensagens, pensando]);
  useEffect(() => { setMensagens([]); setCusto(0); }, [hotelId]);

  async function enviar() {
    const t = texto.trim();
    if (!t || pensando) return;
    const lista = [...mensagens, { papel: 'cliente', texto: t }];
    setMensagens(lista);
    setTexto('');
    setPensando(true);
    try {
      const historico = lista.filter((m) => m.papel === 'cliente' || m.papel === 'robo' || m.papel === 'cotacao')
        .map((m) => ({ papel: m.papel === 'cliente' ? 'cliente' : 'robo', texto: m.texto }));
      const r = await chamarApi('/api/atendimento', { acao: 'robo_testar', hotelId, mensagens: historico, usarRascunho });
      const novas = (r.respostas || []).map((x) => ({ papel: x.tipo === 'texto' ? 'robo' : x.tipo, texto: x.texto }));
      if (!novas.length) novas.push({ papel: 'acao', texto: '(o robô não escreveu nada desta vez)' });
      const qtd = Number(r.mensagensWhatsApp ?? novas.filter((m) => m.papel === 'robo' || m.papel === 'cotacao').length);
      setMensagens([...lista, ...novas, { papel: 'custo', texto: `${dolares(r.custo, 4)} · ${MODELOS_IA[r.modelo]?.nome || r.modelo} · ${qtd} ${qtd === 1 ? 'mensagem' : 'mensagens'} no WhatsApp${r.economico ? ' (modo econômico)' : ''}` }]);
      setCusto((c) => c + Number(r.custo || 0));
    } catch (e) {
      setMensagens([...lista, { papel: 'erro', texto: erroAmigavel(e) }]);
    }
    setPensando(false);
  }

  if (!temChave) {
    return <section className="at-cartao"><h2>💬 Testar o robô</h2><p className="at-dica">Primeiro guarde a chave da Anthropic em “Configuração”.</p></section>;
  }

  return (
    <section className="at-cartao">
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        <h2>💬 Testar o robô de {nomeHotel}</h2>
        <div className="at-botoes" style={{ marginTop: 0 }}>
          <select className="at-select" value={usarRascunho ? 'r' : 'p'} onChange={(e) => setUsarRascunho(e.target.value === 'r')} aria-label="Conteúdo usado no teste">
            <option value="r" disabled={!temRascunho && temPublicado}>Usar o rascunho</option>
            <option value="p" disabled={!temPublicado}>Usar o publicado</option>
          </select>
          <button type="button" className="at-btn" onClick={() => { setMensagens([]); setCusto(0); }} disabled={pensando}>Recomeçar</button>
        </div>
      </div>
      <p className="at-dica" style={{ marginTop: 4 }}>
        Escreva como se fosse um cliente no WhatsApp. Os preços e a disponibilidade são reais (Cloudbeds), mas nada é enviado a cliente nem gravado no funil.
        Cada resposta custa uma fração de centavo de dólar.{custo > 0 ? ` Este teste: ${dolares(custo, 4)}.` : ''}
      </p>
      <div className="at-teste">
        {mensagens.length === 0 && <div className="at-vazio">Experimente: “Oi, tem quarto para 2 adultos de 14 a 16 de novembro?” ou “Vocês aceitam cachorro?”</div>}
        {mensagens.map((m, i) => {
          if (m.papel === 'acao' || m.papel === 'custo' || m.papel === 'erro') {
            return (
              <div key={i} className="at-linha nota">
                <div className="at-sistema" style={m.papel === 'erro' ? { background: '#FDECEA', color: '#B42318' } : undefined}>{m.papel === 'custo' ? `💵 ${m.texto}` : m.texto}</div>
              </div>
            );
          }
          const cliente = m.papel === 'cliente';
          return (
            <div key={i} className={`at-linha ${cliente ? 'saida' : 'entrada'}`}>
              <div className="at-bolha">
                <div className="at-bolha-autor">{cliente ? 'Você (como cliente)' : m.papel === 'cotacao' ? '🤖 Robô · cotação' : '🤖 Robô'}</div>
                <div className="at-bolha-texto" style={{ whiteSpace: 'pre-wrap' }}>{m.texto}</div>
              </div>
            </div>
          );
        })}
        {pensando && <div className="at-linha entrada"><div className="at-bolha"><div className="at-bolha-autor">🤖 Robô</div>digitando…</div></div>}
        <div ref={fimRef} />
      </div>
      <div className="at-escrever-linha" style={{ display: 'flex', gap: 8, marginTop: 10 }}>
        <textarea className="at-textarea" rows={2} value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="Mensagem do cliente…"
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); enviar(); } }} disabled={pensando} />
        <button type="button" className="at-btn at-btn-verde" onClick={enviar} disabled={pensando || !texto.trim()}>Enviar</button>
      </div>
    </section>
  );
}

export { juntarAssuntos };
