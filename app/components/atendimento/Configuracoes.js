'use client';

// ============================================================================
// CAIXA DE ENTRADA — abas "Canais" (só ADMIN) e "Respostas prontas"
// ============================================================================

import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../../../lib/supabaseClient';
import { chamarApi, dataHora } from './util';

function Copiar({ valor }) {
  const [copiado, setCopiado] = useState(false);
  return (
    <div className="at-copiar">
      <code>{valor || '—'}</code>
      <button type="button" className="at-btn" disabled={!valor} onClick={async () => {
        try { await navigator.clipboard.writeText(valor); setCopiado(true); setTimeout(() => setCopiado(false), 1500); } catch (e) { /* nada */ }
      }}>{copiado ? 'Copiado ✓' : 'Copiar'}</button>
    </div>
  );
}

function Situacao({ canal }) {
  return (
    <div className="at-dica">
      {canal.ativo ? (canal.status === 'ERRO' ? <span className="at-ruim">⚠️ Com problema</span> : <span className="at-ok">● Funcionando</span>) : <span className="at-ruim">○ Desligado</span>}
      {canal.ultima_sincronizacao ? ` · última atividade ${dataHora(canal.ultima_sincronizacao)}` : ''}
      {canal.erro && <div className="at-erro-envio">{canal.erro}</div>}
    </div>
  );
}

// ---------------------------------------------------------------------------
export function ConfigCanais() {
  const [dados, setDados] = useState(null);
  const [erro, setErro] = useState('');
  const [aviso, setAviso] = useState('');
  const [ocupado, setOcupado] = useState('');

  const [google, setGoogle] = useState({ clientId: '', clientSecret: '' });
  const [emailConectar, setEmailConectar] = useState('');
  const [meta, setMeta] = useState({ appId: '', appSecret: '' });
  const [formWa, setFormWa] = useState(null); // { canalId?, nome, phoneNumberId, wabaId, token }

  const carregar = useCallback(async () => {
    try {
      const r = await chamarApi('/api/atendimento-canais', null, 'GET');
      setDados(r);
      setGoogle((g) => ({ clientId: g.clientId || r.config.googleClientId, clientSecret: '' }));
      setMeta((m) => ({ appId: m.appId || r.config.metaAppId, appSecret: '' }));
    } catch (e) { setErro(e.message); }
  }, []);

  useEffect(() => {
    carregar();
    // Volta do Google (Conectar caixa de e-mail)
    const p = new URLSearchParams(window.location.search);
    if (p.get('gmail') === 'ok') setAviso(`Caixa ${p.get('email') || ''} conectada! Os e-mails dos últimos 3 dias entram em instantes na Caixa de Entrada.`);
    if (p.get('gmail') === 'erro') setErro(p.get('motivo') || 'Não foi possível conectar a caixa de e-mail.');
    if (p.get('gmail')) window.history.replaceState(null, '', '/atendimento?aba=canais');
  }, [carregar]);

  async function acao(nome, corpo, mensagemOk) {
    setOcupado(nome);
    setErro('');
    setAviso('');
    try {
      const r = await chamarApi('/api/atendimento-canais', { acao: nome, ...corpo });
      if (r.aviso) setErro(r.aviso);
      if (mensagemOk) setAviso(typeof mensagemOk === 'function' ? mensagemOk(r) : mensagemOk);
      await carregar();
      setOcupado('');
      return r;
    } catch (e) {
      setErro(e.message);
      await carregar();
      setOcupado('');
      return null;
    }
  }

  async function conectarGmail(email) {
    const r = await acao('conectar_gmail', { email: email || emailConectar });
    if (r?.url) window.location.href = r.url;
  }

  async function sincronizarAgora() {
    setOcupado('sincronizar');
    setErro('');
    try {
      const r = await chamarApi('/api/atendimento', { acao: 'sincronizar', forcar: true });
      setAviso(`Sincronizado: ${r.novas} mensagem(ns) nova(s).${r.erros?.length ? ` Problemas: ${r.erros.join(' | ')}` : ''}`);
    } catch (e) { setErro(e.message); }
    await carregar();
    setOcupado('');
  }

  if (!dados) return erro ? <div className="aviso-erro">{erro}</div> : <p className="texto-suave">Carregando configuração…</p>;

  const emails = dados.canais.filter((c) => c.tipo === 'EMAIL');
  const whats = dados.canais.filter((c) => c.tipo === 'WHATSAPP');
  const googlePronto = !!dados.config.googleClientId && dados.config.googleSecretSalvo;
  const metaPronta = dados.config.metaSecretSalvo && !!dados.config.metaVerifyToken;

  return (
    <div>
      {aviso && <div className="aviso-sucesso">{aviso}</div>}
      {erro && <div className="aviso-erro">{erro}</div>}

      {/* ------------------------------------------------------------ E-MAIL */}
      <section className="at-cartao">
        <h2>✉️ E-mails (Gmail do Google Workspace)</h2>
        <p className="at-dica">Feito uma vez pelo administrador do Workspace. Cada caixa (reservas@, eventos@…) é conectada separadamente.</p>

        <h3 style={{ fontSize: 15, margin: '14px 0 4px' }}>1. Acesso do Google Cloud</h3>
        <ol className="at-passos">
          <li>Em <strong>console.cloud.google.com</strong>, crie um projeto e ative a <strong>Gmail API</strong>.</li>
          <li>Em “Tela de permissão OAuth”, escolha o tipo <strong>Interno</strong>.</li>
          <li>Em “Credenciais”, crie um <strong>ID do cliente OAuth</strong> do tipo “Aplicativo da Web” e cole em “URIs de redirecionamento autorizados” o endereço abaixo.</li>
        </ol>
        <label className="rotulo">Endereço de retorno (copiar para o Google Cloud)</label>
        <Copiar valor={dados.enderecos.retornoGoogle} />
        <div className="at-grade">
          <div>
            <label className="rotulo" htmlFor="g-id">ID do cliente</label>
            <input id="g-id" className="campo" value={google.clientId} onChange={(e) => setGoogle({ ...google, clientId: e.target.value })} placeholder="…apps.googleusercontent.com" />
          </div>
          <div>
            <label className="rotulo" htmlFor="g-secret">Chave secreta do cliente</label>
            <input id="g-secret" className="campo" type="password" autoComplete="off" value={google.clientSecret}
              onChange={(e) => setGoogle({ ...google, clientSecret: e.target.value })}
              placeholder={dados.config.googleSecretSalvo ? '•••••• (salva — preencha só para trocar)' : 'GOCSPX-…'} />
          </div>
        </div>
        <div className="at-botoes">
          <button type="button" className="at-btn at-btn-verde" disabled={ocupado === 'salvar_google'}
            onClick={() => acao('salvar_google', google, 'Acesso do Google salvo.')}>{ocupado === 'salvar_google' ? 'Salvando…' : 'Salvar acesso do Google'}</button>
          {googlePronto && <span className="at-ok" style={{ alignSelf: 'center' }}>✓ Configurado</span>}
        </div>

        <h3 style={{ fontSize: 15, margin: '18px 0 4px' }}>2. Caixas de e-mail</h3>
        {emails.length === 0 && <p className="at-dica">Nenhuma caixa conectada ainda.</p>}
        {emails.map((c) => (
          <div key={c.id} className="at-canal">
            <div className="at-canal-topo">
              <div>
                <strong>{c.nome}</strong>
                {c.config?.nomeExibicao && <span className="texto-suave" style={{ fontSize: 13 }}> · envia como “{c.config.nomeExibicao}”</span>}
              </div>
              <div className="at-botoes" style={{ marginTop: 0 }}>
                <button type="button" className="at-btn" disabled={!!ocupado} onClick={() => acao('testar', { canalId: c.id }, (r) => r.detalhe)}>Testar</button>
                <button type="button" className="at-btn" disabled={!!ocupado} onClick={() => conectarGmail(c.identificador)}>Reconectar</button>
                <button type="button" className="at-btn" disabled={!!ocupado} onClick={() => acao('alterar', { canalId: c.id, ativo: !c.ativo }, c.ativo ? 'Caixa desligada.' : 'Caixa ligada.')}>{c.ativo ? 'Desligar' : 'Ligar'}</button>
                <button type="button" className="at-btn at-btn-perigo" disabled={!!ocupado} onClick={() => {
                  if (window.confirm(`Desconectar a caixa ${c.nome}? As conversas antigas continuam visíveis, mas não será mais possível responder por ela.`)) acao('excluir', { canalId: c.id }, 'Caixa desconectada.');
                }}>Desconectar</button>
              </div>
            </div>
            <Situacao canal={c} />
            <label className="at-dica" style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <input type="checkbox" checked={c.config?.usarAssinatura !== false} disabled={!!ocupado}
                onChange={(e) => acao('alterar', { canalId: c.id, usarAssinatura: e.target.checked })} />
              Colocar a assinatura do Gmail nas respostas {c.config?.assinatura ? '' : '(esta caixa não tem assinatura no Gmail)'}
            </label>
          </div>
        ))}
        <div className="at-grade" style={{ marginTop: 10 }}>
          <div>
            <label className="rotulo" htmlFor="g-email">E-mail da caixa a conectar (opcional)</label>
            <input id="g-email" className="campo" type="email" value={emailConectar} onChange={(e) => setEmailConectar(e.target.value)} placeholder="reservas@seuhotel.com.br" />
          </div>
        </div>
        <div className="at-botoes">
          <button type="button" className="at-btn at-btn-verde" disabled={!googlePronto || !!ocupado} onClick={() => conectarGmail()}>
            ➕ Conectar caixa de e-mail
          </button>
          {emails.length > 0 && <button type="button" className="at-btn" disabled={!!ocupado} onClick={sincronizarAgora}>{ocupado === 'sincronizar' ? 'Buscando…' : '🔄 Buscar e-mails agora'}</button>}
        </div>
        {!googlePronto && <p className="at-dica">Salve o acesso do Google (passo 1) antes de conectar.</p>}
        <p className="at-dica">Ao conectar, entre no Google com a conta da caixa (ex.: reservas@) e autorize. Os e-mails novos entram sozinhos a cada 2 minutos.</p>
      </section>

      {/* ------------------------------------------------------------ WHATSAPP */}
      <section className="at-cartao">
        <h2>🟢 WhatsApp (API oficial da Meta)</h2>
        <p className="at-dica">Use primeiro o número de teste. Um número só pode estar ligado a um sistema por vez (se estiver no Asksuite, precisa sair de lá).</p>

        <h3 style={{ fontSize: 15, margin: '14px 0 4px' }}>1. App da Meta</h3>
        <div className="at-grade">
          <div>
            <label className="rotulo" htmlFor="m-id">ID do app (opcional)</label>
            <input id="m-id" className="campo" value={meta.appId} onChange={(e) => setMeta({ ...meta, appId: e.target.value })} />
          </div>
          <div>
            <label className="rotulo" htmlFor="m-secret">Chave secreta do app (App Secret)</label>
            <input id="m-secret" className="campo" type="password" autoComplete="off" value={meta.appSecret}
              onChange={(e) => setMeta({ ...meta, appSecret: e.target.value })}
              placeholder={dados.config.metaSecretSalvo ? '•••••• (salva — preencha só para trocar)' : 'Configurações do app → Básico'} />
          </div>
        </div>
        <div className="at-botoes">
          <button type="button" className="at-btn at-btn-verde" disabled={ocupado === 'salvar_meta'}
            onClick={() => acao('salvar_meta', meta, 'App da Meta salvo.')}>{ocupado === 'salvar_meta' ? 'Salvando…' : 'Salvar app da Meta'}</button>
          {metaPronta && <span className="at-ok" style={{ alignSelf: 'center' }}>✓ Configurado</span>}
        </div>
        {metaPronta && (
          <>
            <p className="at-dica" style={{ marginTop: 12 }}>No app da Meta → <strong>WhatsApp → Configuração → Webhook</strong>, cole estes dois valores e assine o campo <strong>messages</strong>:</p>
            <label className="rotulo">URL de retorno de chamada (Callback URL)</label>
            <Copiar valor={dados.enderecos.webhookMeta} />
            <label className="rotulo">Token de verificação (Verify token)</label>
            <Copiar valor={dados.config.metaVerifyToken} />
            <button type="button" className="at-link-pequeno" style={{ marginTop: 6 }} onClick={() => {
              if (window.confirm('Gerar outro token de verificação? Será preciso colar o novo token no app da Meta.')) acao('novo_token_meta', {}, 'Novo token gerado.');
            }}>Gerar outro token de verificação</button>
          </>
        )}

        <h3 style={{ fontSize: 15, margin: '18px 0 4px' }}>2. Números de WhatsApp</h3>
        {whats.length === 0 && <p className="at-dica">Nenhum número cadastrado ainda.</p>}
        {whats.map((c) => (
          <div key={c.id} className="at-canal">
            <div className="at-canal-topo">
              <div>
                <strong>{c.nome}</strong>
                <span className="texto-suave" style={{ fontSize: 13 }}> · {c.endereco_exibicao || c.identificador}{c.config?.nomeVerificado ? ` · ${c.config.nomeVerificado}` : ''}{c.config?.qualidade ? ` · qualidade ${c.config.qualidade}` : ''}</span>
              </div>
              <div className="at-botoes" style={{ marginTop: 0 }}>
                <button type="button" className="at-btn" disabled={!!ocupado} onClick={() => acao('testar', { canalId: c.id }, (r) => r.detalhe)}>Testar</button>
                <button type="button" className="at-btn" disabled={!!ocupado} onClick={() => setFormWa({ canalId: c.id, nome: c.nome, phoneNumberId: c.identificador, wabaId: c.config?.wabaId || '', token: '' })}>Editar</button>
                <button type="button" className="at-btn" disabled={!!ocupado} onClick={() => {
                  const pin = window.prompt('PIN de 6 números (confirmação em duas etapas do número no WhatsApp Manager):');
                  if (pin) acao('registrar_numero', { canalId: c.id, pin }, 'Número registrado na API.');
                }}>Registrar número</button>
                <button type="button" className="at-btn" disabled={!!ocupado} onClick={() => acao('alterar', { canalId: c.id, ativo: !c.ativo }, c.ativo ? 'Número desligado.' : 'Número ligado.')}>{c.ativo ? 'Desligar' : 'Ligar'}</button>
                <button type="button" className="at-btn at-btn-perigo" disabled={!!ocupado} onClick={() => {
                  if (window.confirm(`Excluir o número ${c.nome} do sistema? As conversas antigas continuam visíveis, mas não será mais possível responder por ele.`)) acao('excluir', { canalId: c.id }, 'Número excluído do sistema.');
                }}>Excluir</button>
              </div>
            </div>
            <Situacao canal={c} />
          </div>
        ))}

        {formWa ? (
          <div className="at-canal" style={{ background: '#FAFBF9' }}>
            <strong>{formWa.canalId ? 'Editar número' : 'Adicionar número'}</strong>
            <div className="at-grade">
              <div>
                <label className="rotulo" htmlFor="w-nome">Nome no sistema</label>
                <input id="w-nome" className="campo" value={formWa.nome} onChange={(e) => setFormWa({ ...formWa, nome: e.target.value })} placeholder="WhatsApp Recepção (teste)" />
              </div>
              <div>
                <label className="rotulo" htmlFor="w-phone">ID do número de telefone</label>
                <input id="w-phone" className="campo" value={formWa.phoneNumberId} disabled={!!formWa.canalId} onChange={(e) => setFormWa({ ...formWa, phoneNumberId: e.target.value })} placeholder="Phone number ID" />
              </div>
              <div>
                <label className="rotulo" htmlFor="w-waba">ID da conta do WhatsApp Business</label>
                <input id="w-waba" className="campo" value={formWa.wabaId} onChange={(e) => setFormWa({ ...formWa, wabaId: e.target.value })} placeholder="WhatsApp Business Account ID" />
              </div>
              <div>
                <label className="rotulo" htmlFor="w-token">Token de acesso permanente</label>
                <input id="w-token" className="campo" type="password" autoComplete="off" value={formWa.token} onChange={(e) => setFormWa({ ...formWa, token: e.target.value })}
                  placeholder={formWa.canalId ? '•••••• (preencha só para trocar)' : 'Token do usuário do sistema'} />
              </div>
            </div>
            <p className="at-dica">Os dois IDs ficam no app da Meta → WhatsApp → Configuração da API. O token permanente é criado em business.facebook.com → Configurações → Usuários do sistema.</p>
            <div className="at-botoes">
              <button type="button" className="at-btn at-btn-verde" disabled={ocupado === 'salvar_whatsapp'} onClick={async () => {
                const r = await acao('salvar_whatsapp', formWa, (x) => `Número ${x.canal?.endereco_exibicao || ''} salvo e testado.`);
                if (r) setFormWa(null);
              }}>{ocupado === 'salvar_whatsapp' ? 'Testando…' : 'Salvar e testar'}</button>
              <button type="button" className="at-btn" onClick={() => setFormWa(null)}>Cancelar</button>
            </div>
          </div>
        ) : (
          <div className="at-botoes">
            <button type="button" className="at-btn at-btn-verde" disabled={!metaPronta} onClick={() => setFormWa({ nome: '', phoneNumberId: '', wabaId: '', token: '' })}>➕ Adicionar número</button>
            {!metaPronta && <span className="at-dica" style={{ alignSelf: 'center' }}>Salve o app da Meta (passo 1) antes.</span>}
          </div>
        )}
      </section>

      <section className="at-cartao">
        <h2>📸 Instagram e 💬 Facebook</h2>
        <p className="at-dica">Chegam na Parte B, usando o mesmo app da Meta configurado acima.</p>
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
export function RespostasProntas({ usuario, respostas, hoteis, multiHotel, onMudou }) {
  const [form, setForm] = useState(null); // { id?, hotel_id, atalho, titulo, texto }
  const [hotelVer, setHotelVer] = useState('');
  const nomesHoteis = Object.fromEntries((hoteis || []).map((h) => [h.id, h.nome]));
  const visiveis = hotelVer ? respostas.filter((r) => r.hotel_id === Number(hotelVer)) : respostas;
  const [erro, setErro] = useState('');
  const [salvando, setSalvando] = useState(false);

  async function salvar() {
    const atalho = String(form.atalho || '').trim().replace(/^\//, '').replace(/\s+/g, '').toLowerCase();
    if (!atalho || !String(form.texto || '').trim()) { setErro('Preencha o atalho e o texto.'); return; }
    setSalvando(true);
    setErro('');
    const registro = { atalho, titulo: String(form.titulo || '').trim() || null, texto: form.texto.trim(), atualizado_em: new Date().toISOString() };
    const { error } = form.id
      ? await supabase.from('atendimento_respostas_prontas').update(registro).eq('id', form.id)
      : await supabase.from('atendimento_respostas_prontas').insert({ ...registro, hotel_id: Number(form.hotel_id) || usuario.hotel_id, criado_por_id: usuario.id });
    setSalvando(false);
    if (error) {
      setErro(/duplicate|unique/i.test(error.message) ? `Já existe uma resposta com o atalho /${atalho}.` : 'Não foi possível salvar: ' + error.message);
      return;
    }
    setForm(null);
    onMudou();
  }

  async function excluir(r) {
    if (!window.confirm(`Excluir a resposta /${r.atalho}?`)) return;
    const { error } = await supabase.from('atendimento_respostas_prontas').delete().eq('id', r.id);
    if (error) { setErro('Não foi possível excluir: ' + error.message); return; }
    onMudou();
  }

  return (
    <section className="at-cartao">
      <div className="at-canal-topo">
        <h2>⚡ Respostas prontas</h2>
        <div className="at-botoes" style={{ marginTop: 0 }}>
          {multiHotel && (
            <select className="at-select" value={hotelVer} onChange={(e) => setHotelVer(e.target.value)} aria-label="Hotel">
              <option value="">Todos os hotéis</option>
              {hoteis.map((h) => <option key={h.id} value={h.id}>{h.nome}</option>)}
            </select>
          )}
          <button type="button" className="at-btn at-btn-verde" onClick={() => { setErro(''); setForm({ hotel_id: Number(hotelVer) || Number(usuario.hotel_id), atalho: '', titulo: '', texto: '' }); }}>+ Nova resposta</button>
        </div>
      </div>
      <p className="at-dica">Na conversa, digite <strong>/</strong> e o atalho (ex.: <strong>/checkin</strong>). Use <strong>{'{nome}'}</strong> para o primeiro nome do cliente e <strong>{'{atendente}'}</strong> para o seu.</p>
      {erro && <div className="aviso-erro">{erro}</div>}

      {form && (
        <div className="at-canal" style={{ background: '#FAFBF9' }}>
          {multiHotel && !form.id && (
            <>
              <label className="rotulo" htmlFor="r-hotel">Hotel</label>
              <select id="r-hotel" className="campo" value={form.hotel_id} onChange={(e) => setForm({ ...form, hotel_id: Number(e.target.value) })}>
                {hoteis.map((h) => <option key={h.id} value={h.id}>{h.nome}</option>)}
              </select>
            </>
          )}
          <div className="at-grade">
            <div>
              <label className="rotulo" htmlFor="r-atalho">Atalho</label>
              <input id="r-atalho" className="campo" value={form.atalho} onChange={(e) => setForm({ ...form, atalho: e.target.value })} placeholder="checkin" />
            </div>
            <div>
              <label className="rotulo" htmlFor="r-titulo">Título (opcional)</label>
              <input id="r-titulo" className="campo" value={form.titulo || ''} onChange={(e) => setForm({ ...form, titulo: e.target.value })} placeholder="Horário de check-in" />
            </div>
          </div>
          <label className="rotulo" htmlFor="r-texto">Texto</label>
          <textarea id="r-texto" className="campo" rows={5} value={form.texto} onChange={(e) => setForm({ ...form, texto: e.target.value })}
            placeholder={'Olá, {nome}! O check-in é a partir das 14h e o check-out até as 12h. Qualquer dúvida, estou à disposição. {atendente}'} />
          <div className="at-botoes">
            <button type="button" className="at-btn at-btn-verde" onClick={salvar} disabled={salvando}>{salvando ? 'Salvando…' : 'Salvar'}</button>
            <button type="button" className="at-btn" onClick={() => setForm(null)}>Cancelar</button>
          </div>
        </div>
      )}

      {visiveis.length === 0 && !form && <p className="at-vazio">Nenhuma resposta pronta ainda.</p>}
      {visiveis.map((r) => (
        <div key={r.id} className="at-canal">
          <div className="at-canal-topo">
            <div>
              <strong>/{r.atalho}</strong>{r.titulo ? <span className="texto-suave"> — {r.titulo}</span> : null}
              {multiHotel && nomesHoteis[r.hotel_id] && <span className="at-chip" style={{ marginLeft: 8 }}>🏨 {nomesHoteis[r.hotel_id]}</span>}
            </div>
            <div className="at-botoes" style={{ marginTop: 0 }}>
              <button type="button" className="at-btn" onClick={() => { setErro(''); setForm({ ...r }); }}>Editar</button>
              <button type="button" className="at-btn at-btn-perigo" onClick={() => excluir(r)}>Excluir</button>
            </div>
          </div>
          <div className="at-dica" style={{ whiteSpace: 'pre-wrap' }}>{r.texto}</div>
        </div>
      ))}
    </section>
  );
}
