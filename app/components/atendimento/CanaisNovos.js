'use client';

// ============================================================================
// CAIXA DE ENTRADA → Canais: Instagram e Facebook, Telegram e a conferência
// "Pronto para desligar o Asksuite?" (só ADMIN)
// ============================================================================
// Usado por Configuracoes.js (ConfigCanais), que passa os dados da aba e a
// função "acao" (chama /api/atendimento-canais e recarrega).
// ============================================================================

import { useState } from 'react';
import { chamarApi, dataHora } from './util';

// ---------------------------------------------------------------------------
// Instagram (Direct) e Facebook (Messenger)
export function SecaoMetaPaginas({ dados, acao, ocupado, metaPronta, Situacao }) {
  const [token, setToken] = useState('');
  const [paginas, setPaginas] = useState(null);
  const [erroLista, setErroLista] = useState('');
  const [buscando, setBuscando] = useState(false);
  const canais = dados.canais.filter((c) => c.tipo === 'INSTAGRAM' || c.tipo === 'FACEBOOK');

  async function buscar() {
    setBuscando(true); setErroLista(''); setPaginas(null);
    try {
      const r = await chamarApi('/api/atendimento-canais', { acao: 'meta_paginas', token });
      setPaginas(r.paginas || []);
    } catch (e) { setErroLista(e.message); }
    setBuscando(false);
  }

  async function conectar(pagina, tipo) {
    const nome = tipo === 'INSTAGRAM' ? `Instagram @${pagina.instagram?.usuario || ''}` : `Facebook ${pagina.nome}`;
    const r = await acao('conectar_meta', { token, pageId: pagina.id, tipo }, `${nome} conectado. Mande uma mensagem de teste para ver chegar aqui.`);
    if (r) await buscar();
  }

  return (
    <section className="at-cartao">
      <h2>📸 Instagram e 💬 Facebook Messenger</h2>
      <p className="at-dica">As mensagens do Direct do Instagram e do Messenger da Página chegam aqui, junto com o WhatsApp. Usa o mesmo app da Meta do WhatsApp.</p>
      {!metaPronta && <p className="aviso-erro" style={{ margin: '8px 0' }}>Salve antes o app da Meta (seção WhatsApp, passo 1).</p>}

      <h3 style={{ fontSize: 15, margin: '14px 0 4px' }}>1. Avisos de mensagem (webhooks) no app da Meta</h3>
      <ol className="at-passos">
        <li>Em developers.facebook.com → seu app, adicione os produtos <strong>Messenger</strong> e <strong>Instagram</strong>.</li>
        <li>Clique no botão abaixo: o sistema assina os avisos da <strong>Página</strong> e do <strong>Instagram</strong> com o mesmo endereço e token de verificação do WhatsApp. (Precisa do “ID do app” salvo no passo 1 do WhatsApp.)</li>
      </ol>
      <div className="at-botoes">
        <button type="button" className="at-btn at-btn-verde" disabled={!metaPronta || !!ocupado}
          onClick={() => acao('meta_webhooks', {}, 'Avisos da Página e do Instagram assinados no app da Meta.')}>
          {ocupado === 'meta_webhooks' ? 'Assinando…' : '🔗 Assinar os avisos automaticamente'}
        </button>
      </div>
      <p className="at-dica">Se preferir fazer à mão: no app → Webhooks, objeto <strong>Page</strong> (campos messages, messaging_postbacks, message_echoes, messaging_referrals, standby) e objeto <strong>Instagram</strong> (campo messages), com a mesma URL e o mesmo token de verificação do WhatsApp.</p>

      <h3 style={{ fontSize: 15, margin: '18px 0 4px' }}>2. Conectar a Página e o Instagram</h3>
      <ol className="at-passos">
        <li>Em business.facebook.com → Configurações → <strong>Usuários do sistema</strong>, abra o mesmo usuário usado no WhatsApp e, em “Atribuir ativos”, dê <strong>controle total</strong> da Página do hotel e da conta do Instagram.</li>
        <li>Gere um token com as permissões <code>pages_show_list</code>, <code>pages_manage_metadata</code>, <code>pages_messaging</code>, <code>instagram_basic</code>, <code>instagram_manage_messages</code> e <code>business_management</code>.</li>
        <li>Cole o token aqui e clique em “Buscar Páginas”. O token não fica salvo: só a chave de cada Página que você conectar (criptografada).</li>
      </ol>
      <div className="at-grade">
        <div>
          <label className="rotulo" htmlFor="mp-token">Token do usuário do sistema</label>
          <input id="mp-token" className="campo" type="password" autoComplete="off" value={token} onChange={(e) => setToken(e.target.value)} placeholder="EAAG…" />
        </div>
      </div>
      <div className="at-botoes">
        <button type="button" className="at-btn" disabled={!metaPronta || !token.trim() || buscando} onClick={buscar}>{buscando ? 'Buscando…' : '🔎 Buscar Páginas'}</button>
      </div>
      {erroLista && <div className="aviso-erro">{erroLista}</div>}
      {paginas && !paginas.length && <p className="at-dica">Nenhuma Página encontrada para este token.</p>}
      {paginas && paginas.map((p) => (
        <div key={p.id} className="at-canal mp-pagina">
          <div className="at-canal-topo">
            <div><strong>💬 {p.nome}</strong> <span className="texto-suave" style={{ fontSize: 13 }}>· Página do Facebook</span></div>
            {p.canalFacebook
              ? <span className="at-ok">✓ Messenger conectado</span>
              : <button type="button" className="at-btn at-btn-verde" disabled={!!ocupado} onClick={() => conectar(p, 'FACEBOOK')}>Conectar o Messenger</button>}
          </div>
          <div className="at-canal-topo" style={{ marginTop: 8 }}>
            {p.instagram ? (
              <>
                <div><strong>📸 @{p.instagram.usuario || p.instagram.nome}</strong> <span className="texto-suave" style={{ fontSize: 13 }}>· Instagram ligado à Página</span></div>
                {p.instagram.canal
                  ? <span className="at-ok">✓ Direct conectado</span>
                  : <button type="button" className="at-btn at-btn-verde" disabled={!!ocupado} onClick={() => conectar(p, 'INSTAGRAM')}>Conectar o Instagram</button>}
              </>
            ) : <span className="at-dica" style={{ margin: 0 }}>Sem Instagram ligado a esta Página (ligue em Configurações da Página → Contas vinculadas).</span>}
          </div>
        </div>
      ))}

      <h3 style={{ fontSize: 15, margin: '18px 0 4px' }}>Conectados</h3>
      {canais.length === 0 && <p className="at-dica">Nenhum conectado ainda.</p>}
      {canais.map((c) => (
        <div key={c.id} className="at-canal">
          <div className="at-canal-topo">
            <div>
              <strong>{c.tipo === 'INSTAGRAM' ? '📸' : '💬'} {c.nome}</strong>
              <span className="texto-suave" style={{ fontSize: 13 }}> · {c.tipo === 'INSTAGRAM' ? 'Direct do Instagram' : 'Messenger'}{c.config?.pagina ? ` · Página ${c.config.pagina}` : ''}</span>
            </div>
            <div className="at-botoes" style={{ marginTop: 0 }}>
              <button type="button" className="at-btn" disabled={!!ocupado} onClick={() => acao('testar', { canalId: c.id }, (r) => r.detalhe)}>Testar</button>
              <button type="button" className="at-btn" disabled={!!ocupado} onClick={() => acao('alterar', { canalId: c.id, ativo: !c.ativo }, c.ativo ? 'Desligado.' : 'Ligado.')}>{c.ativo ? 'Desligar' : 'Ligar'}</button>
              <button type="button" className="at-btn at-btn-perigo" disabled={!!ocupado} onClick={() => {
                if (window.confirm(`Desconectar ${c.nome}? As conversas antigas continuam visíveis, mas não será mais possível responder por aqui.`)) acao('excluir', { canalId: c.id }, 'Desconectado.');
              }}>Desconectar</button>
            </div>
          </div>
          <Situacao canal={c} />
        </div>
      ))}

      <div className="mp-alerta">
        <strong>⚠️ Liberação da Meta (uma vez só).</strong> Até o app passar pela análise da Meta, só quem tem função no app (administrador, desenvolvedor, testador) consegue conversar.
        Para liberar para todos os clientes: developers.facebook.com → seu app → <strong>Análise do app</strong> → peça o <strong>Acesso avançado</strong> de <code>pages_messaging</code> e <code>instagram_manage_messages</code> (a Meta pede a empresa verificada e um vídeo curto mostrando a resposta pelo sistema).
      </div>
      <div className="mp-alerta mp-alerta-azul">
        <strong>Enquanto o Asksuite estiver ligado na Página,</strong> as mensagens também chegam aqui, marcadas como recebidas “em espera”, e o robô do sistema não responde. Na hora da troca, siga o passo a passo de “Desligar o Asksuite” no topo desta aba.
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Telegram
export function SecaoTelegram({ dados, acao, ocupado, Situacao }) {
  const [form, setForm] = useState(null); // { canalId?, nome, token }
  const canais = dados.canais.filter((c) => c.tipo === 'TELEGRAM');
  return (
    <section className="at-cartao">
      <h2>✈️ Telegram</h2>
      <p className="at-dica">Os clientes conversam com o robô do hotel no Telegram (por exemplo, @jrhotel_bot) e as mensagens chegam aqui. O link t.me/… pode ir no site, no Instagram e na assinatura do e-mail.</p>
      {canais.map((c) => (
        <div key={c.id} className="at-canal">
          <div className="at-canal-topo">
            <div>
              <strong>✈️ {c.nome}</strong>
              {c.config?.link && <span className="texto-suave" style={{ fontSize: 13 }}> · <a href={c.config.link} target="_blank" rel="noopener noreferrer">{c.config.link.replace('https://', '')}</a></span>}
            </div>
            <div className="at-botoes" style={{ marginTop: 0 }}>
              <button type="button" className="at-btn" disabled={!!ocupado} onClick={() => acao('testar', { canalId: c.id }, (r) => r.detalhe)}>Testar</button>
              <button type="button" className="at-btn" disabled={!!ocupado} onClick={() => setForm({ canalId: c.id, nome: c.nome, token: '' })}>Editar</button>
              <button type="button" className="at-btn" disabled={!!ocupado} onClick={() => acao('alterar', { canalId: c.id, ativo: !c.ativo }, c.ativo ? 'Telegram desligado.' : 'Telegram ligado.')}>{c.ativo ? 'Desligar' : 'Ligar'}</button>
              <button type="button" className="at-btn at-btn-perigo" disabled={!!ocupado} onClick={() => {
                if (window.confirm(`Desconectar ${c.nome}? As conversas antigas continuam visíveis, mas o robô do Telegram para de entregar mensagens aqui.`)) acao('excluir', { canalId: c.id }, 'Telegram desconectado.');
              }}>Desconectar</button>
            </div>
          </div>
          <Situacao canal={c} />
        </div>
      ))}
      {form ? (
        <div className="at-canal" style={{ background: '#FAFBF9' }}>
          <strong>{form.canalId ? 'Editar robô do Telegram' : 'Conectar o Telegram'}</strong>
          {!form.canalId && (
            <ol className="at-passos">
              <li>No Telegram, abra o <strong>@BotFather</strong> (o oficial, com o selo azul) e mande <code>/newbot</code>.</li>
              <li>Escolha o nome que o cliente vê (ex.: J. R. Hotel) e o usuário, que termina em “bot” (ex.: jrhotel_bot).</li>
              <li>O BotFather entrega um <strong>token</strong> (1234567890:AAH…). Copie e cole aqui.</li>
            </ol>
          )}
          <div className="at-grade">
            <div>
              <label className="rotulo" htmlFor="tg-nome">Nome no sistema</label>
              <input id="tg-nome" className="campo" value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} placeholder="Em branco: Telegram @usuario_do_robo" />
            </div>
            <div>
              <label className="rotulo" htmlFor="tg-token">Token do @BotFather</label>
              <input id="tg-token" className="campo" type="password" autoComplete="off" value={form.token} onChange={(e) => setForm({ ...form, token: e.target.value })}
                placeholder={form.canalId ? '•••••• (preencha só para trocar)' : '1234567890:AAH…'} />
            </div>
          </div>
          <div className="at-botoes">
            <button type="button" className="at-btn at-btn-verde" disabled={ocupado === 'salvar_telegram'} onClick={async () => {
              const r = await acao('salvar_telegram', form, (x) => `Robô ${x.canal?.endereco_exibicao || ''} conectado. Mande uma mensagem para ele no Telegram para testar.`);
              if (r) setForm(null);
            }}>{ocupado === 'salvar_telegram' ? 'Conferindo…' : 'Salvar e ligar'}</button>
            <button type="button" className="at-btn" onClick={() => setForm(null)}>Cancelar</button>
          </div>
        </div>
      ) : !canais.length && (
        <div className="at-botoes">
          <button type="button" className="at-btn at-btn-verde" disabled={!!ocupado} onClick={() => setForm({ nome: '', token: '' })}>➕ Conectar o Telegram</button>
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// "Pronto para desligar o Asksuite?"
const ICONE = { OK: '✅', FALTA: '❌', ATENCAO: '⚠️', OPCIONAL: '➖' };
const PASSOS_TROCA = [
  ['Guarde o histórico', 'Antes de tudo, exporte do Asksuite a planilha de conversas e a de contatos e importe aqui (Contatos → Importar planilha). Depois de cancelar, não dá mais para exportar.'],
  ['Conecte os canais com o Asksuite ainda ligado', 'Conecte aqui o WhatsApp, o Instagram e o Facebook. As mensagens passam a chegar nos dois lugares. Deixe o robô do sistema DESLIGADO nesses canais por enquanto, para o cliente não receber duas respostas.'],
  ['Deixe esta lista sem ❌', 'Resolva cada item com ❌. Os ⚠️ não impedem, mas vale olhar.'],
  ['Escolha a hora da troca', 'Um horário calmo (de manhã cedo, por exemplo). Avise a equipe que, a partir dali, tudo é respondido pelo sistema.'],
  ['Desligue o Asksuite', 'No Asksuite, desligue o robô, as automações e as campanhas.'],
  ['Tire o Asksuite da Meta', 'Em business.facebook.com → Configurações da empresa: na conta do WhatsApp, na Página e no Instagram, remova o Asksuite de “Parceiros” e de “Apps conectados”. Nas configurações de mensagens da Página, deixe o app do sistema como o que responde. O número continua o mesmo.'],
  ['Ligue o robô do sistema', 'Em 🤖 Robô (IA) → Configuração, marque WhatsApp, Instagram, Facebook e chat do site.'],
  ['Troque o chat do site', 'O Daniel publica a versão do site com o chat do sistema no lugar do Asksuite (PR #1 do site).'],
  ['Teste de outro celular', 'Mande uma mensagem em cada canal e confira que chegou aqui e que o robô respondeu. Depois, clique em “Conferir agora” de novo.'],
  ['Espere uma semana para cancelar', 'Deixe rodar uma semana antes de cancelar o contrato do Asksuite. Se algo der errado, ainda dá para voltar.'],
];

export function ProntoParaDesligar() {
  const [r, setR] = useState(null);
  const [erro, setErro] = useState('');
  const [carregando, setCarregando] = useState(false);
  const [aberto, setAberto] = useState(false);

  async function conferir() {
    setCarregando(true); setErro(''); setAberto(true);
    try { setR(await chamarApi('/api/atendimento-canais', { acao: 'conferir_saida' })); } catch (e) { setErro(e.message); }
    setCarregando(false);
  }

  const grupos = [];
  (r?.itens || []).forEach((i) => {
    if (!grupos.length || grupos[grupos.length - 1].nome !== i.grupo) grupos.push({ nome: i.grupo, itens: [] });
    grupos[grupos.length - 1].itens.push(i);
  });

  return (
    <section className="at-cartao pd-cartao">
      <div className="at-canal-topo">
        <h2 style={{ margin: 0 }}>🚦 Desligar o Asksuite: está tudo pronto?</h2>
        <button type="button" className="at-btn at-btn-verde" onClick={conferir} disabled={carregando}>{carregando ? 'Conferindo…' : r ? '🔄 Conferir de novo' : 'Conferir agora'}</button>
      </div>
      <p className="at-dica">O sistema confere se tudo o que o Asksuite fazia já funciona aqui: os canais recebendo mensagens, o robô, a equipe e as reservas.</p>
      {erro && <div className="aviso-erro">{erro}</div>}
      {r && (
        <>
          <div className={r.pronto ? 'pd-resumo pd-resumo-ok' : 'pd-resumo'} role="status">
            {r.pronto
              ? <>✅ <strong>Pronto para a troca.</strong> {r.atencoes ? `${r.atencoes} ponto(s) de atenção, que não impedem.` : 'Nenhum ponto de atenção.'}</>
              : <>❌ <strong>Ainda não.</strong> Falta(m) {r.faltas} item(ns){r.atencoes ? ` e há ${r.atencoes} ponto(s) de atenção` : ''}.</>}
            <span className="pd-hora"> Conferido em {dataHora(r.conferidoEm)}.</span>
          </div>
          {aberto && grupos.map((g) => (
            <div key={g.nome} className="pd-grupo">
              <h3 className="pd-grupo-titulo">{g.nome}</h3>
              {g.itens.map((i) => (
                <div key={i.chave} className={`pd-item pd-${i.situacao.toLowerCase()}`}>
                  <span className="pd-icone" aria-hidden="true">{ICONE[i.situacao]}</span>
                  <div className="pd-texto">
                    <strong>{i.titulo}</strong>
                    <span>{i.detalhe}</span>
                    {i.situacao !== 'OK' && i.onde && <span className="pd-onde">Onde: {i.onde}</span>}
                  </div>
                </div>
              ))}
            </div>
          ))}
          <button type="button" className="at-link-pequeno" onClick={() => setAberto(!aberto)}>{aberto ? 'Esconder a lista' : 'Mostrar a lista'}</button>
        </>
      )}
      <details className="pd-passos">
        <summary>📋 Passo a passo da troca (ordem segura)</summary>
        <ol>
          {PASSOS_TROCA.map(([titulo, texto]) => <li key={titulo}><strong>{titulo}.</strong> {texto}</li>)}
        </ol>
      </details>
      <style>{`
        .pd-resumo { margin: 10px 0 6px; padding: 10px 12px; border-radius: 10px; background: #FDECEA; color: #7A1C12; font-size: 14px; }
        .pd-resumo-ok { background: #E5F4EA; color: #14532D; }
        .pd-hora { color: inherit; opacity: .75; font-size: 12.5px; }
        .pd-grupo { margin-top: 12px; }
        .pd-grupo-titulo { font-size: 14px; margin: 0 0 6px; text-transform: uppercase; letter-spacing: .04em; color: var(--texto-suave); }
        .pd-item { display: flex; gap: 10px; align-items: flex-start; padding: 8px 10px; border-radius: 10px; border: 1px solid var(--borda); margin-bottom: 6px; }
        .pd-falta { border-color: #F2B8B0; background: #FFF7F6; }
        .pd-atencao { border-color: #F0D58A; background: #FFFBEF; }
        .pd-icone { flex: none; font-size: 16px; line-height: 1.3; }
        .pd-texto { display: flex; flex-direction: column; gap: 2px; min-width: 0; overflow-wrap: anywhere; font-size: 14px; }
        .pd-texto span { color: #3E4944; font-size: 13.5px; }
        .pd-onde { font-size: 12.5px !important; color: var(--texto-suave) !important; }
        .pd-passos { margin-top: 12px; font-size: 14px; }
        .pd-passos summary { cursor: pointer; font-weight: 700; }
        .pd-passos ol { padding-left: 20px; margin: 8px 0 0; }
        .pd-passos li { margin: 6px 0; color: #3E4944; }
        .mp-alerta { margin-top: 12px; padding: 10px 12px; border-radius: 10px; background: #FFF4D6; color: #5E4300; font-size: 13.5px; }
        .mp-alerta-azul { background: #E8F1FB; color: #163E66; }
        .mp-pagina { background: #FAFBF9; }
      `}</style>
    </section>
  );
}
