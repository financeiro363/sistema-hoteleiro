'use client';

// ============================================================================
// ⚙️ CONFIGURAR CLOUDBEDS (caixa) — pop-up do Fechamento de Caixa, SÓ ADMIN
// ============================================================================
// Liga cada forma de pagamento do sistema (Dinheiro, Pix, Crédito, Débito) a
// uma forma de pagamento da Cloudbeds, e escolhe as Contas da Casa usadas para
// as vendas avulsas da Conveniência e para os pagamentos da Sala de Reunião.
// Rota: /api/cloudbeds-caixa-config
// ============================================================================

import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabaseClient';

const AUTOMATICA = '';

export default function ConfigCloudbedsCaixa({ onFechar }) {
  const [carregando, setCarregando] = useState(true);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState('');
  const [aviso, setAviso] = useState('');
  const [dados, setDados] = useState(null); // resposta do GET
  const [formas, setFormas] = useState({}); // { DINHEIRO: {codigo, metodo, nome, cartao} }
  const [contas, setContas] = useState({ conta_pdv_id: '', conta_pdv_nome: '', conta_sala_id: '', conta_sala_nome: '' });
  const [enviar, setEnviar] = useState({ enviar_pdv: true, enviar_sala: true });

  async function token() {
    const { data } = await supabase.auth.getSession();
    return data?.session?.access_token;
  }

  useEffect(() => {
    let ativo = true;
    (async () => {
      try {
        const resposta = await fetch('/api/cloudbeds-caixa-config', { headers: { Authorization: `Bearer ${await token()}` } });
        const json = await resposta.json();
        if (!ativo) return;
        if (!resposta.ok || json.erro) { setErro(json.erro || 'Não foi possível carregar.'); setCarregando(false); return; }
        setDados(json);
        const c = json.config || {};
        setFormas(c.formas || {});
        setContas({
          conta_pdv_id: c.conta_pdv_id || '', conta_pdv_nome: c.conta_pdv_nome || json.nomesPadrao.pdv,
          conta_sala_id: c.conta_sala_id || '', conta_sala_nome: c.conta_sala_nome || json.nomesPadrao.sala,
        });
        setEnviar({ enviar_pdv: c.enviar_pdv !== false, enviar_sala: c.enviar_sala !== false });
      } catch (e) {
        if (ativo) setErro('Falha de conexão com o servidor.');
      }
      if (ativo) setCarregando(false);
    })();
    return () => { ativo = false; };
  }, []);

  const listaFormas = dados?.formasCloudbeds || [];
  const listaContas = dados?.contasCloudbeds || [];

  function escolherForma(chave, codigo) {
    const m = listaFormas.find((f) => f.codigo === codigo);
    setFormas((atual) => ({
      ...atual,
      [chave]: m ? { codigo: m.codigo, metodo: m.metodo, nome: m.nome, cartao: null } : null,
    }));
  }

  function precisaCartao(forma) {
    if (!forma) return false;
    const m = listaFormas.find((f) => f.codigo === forma.codigo);
    return !!m?.cartoes?.length;
  }

  async function salvar() {
    setErro('');
    setAviso('');
    const faltando = Object.entries(dados.formasSistema)
      .filter(([chave]) => !formas[chave]?.codigo && !formas[chave]?.metodo)
      .map(([, nome]) => nome);
    const semCartao = Object.entries(dados.formasSistema)
      .filter(([chave]) => {
        const f = formas[chave];
        const m = f && listaFormas.find((x) => x.codigo === f.codigo);
        return f && (m?.metodo === 'credit' || f.codigo === 'credit') && m?.cartoes?.length && !f.cartao;
      })
      .map(([, nome]) => nome);
    if (semCartao.length) { setErro(`Escolha a bandeira do cartão para: ${semCartao.join(', ')}.`); return; }

    setSalvando(true);
    try {
      const resposta = await fetch('/api/cloudbeds-caixa-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await token()}` },
        body: JSON.stringify({ formas, ...contas, ...enviar }),
      });
      const json = await resposta.json();
      setSalvando(false);
      if (!resposta.ok || json.erro) { setErro(json.erro || 'Não foi possível salvar.'); return; }
      setAviso(faltando.length
        ? `Salvo! Ainda falta ligar: ${faltando.join(', ')}. Pagamentos nessa forma não vão para a Cloudbeds até isso ser feito.`
        : 'Configuração salva! A partir de agora as vendas avulsas e os pagamentos da Sala vão para a Cloudbeds.');
    } catch (e) {
      setSalvando(false);
      setErro('Falha de conexão com o servidor.');
    }
  }

  const seletorConta = (campoId, campoNome, rotuloPadrao) => (
    <div className="cfg-campo">
      <select
        className="campo"
        value={contas[campoId]}
        onChange={(e) => {
          const c = listaContas.find((x) => x.id === e.target.value);
          setContas((a) => ({ ...a, [campoId]: e.target.value, [campoNome]: c ? c.nome : rotuloPadrao }));
        }}
      >
        <option value={AUTOMATICA}>Automática: “{rotuloPadrao}” (o sistema cria se não existir)</option>
        {listaContas.map((c) => <option key={c.id} value={c.id}>{c.nome} (nº {c.id})</option>)}
        {contas[campoId] && !listaContas.some((c) => c.id === contas[campoId]) && (
          <option value={contas[campoId]}>{contas[campoNome] || 'Conta salva'} (nº {contas[campoId]})</option>
        )}
      </select>
    </div>
  );

  return (
    <div className="cfg-overlay" role="dialog" aria-modal="true" aria-label="Configurar Cloudbeds">
      <div className="cfg-modal">
        <div className="cfg-topo">
          <h2 style={{ margin: 0 }}>⚙️ Configurar Cloudbeds (caixa)</h2>
          <button type="button" className="botao botao-suave" onClick={onFechar} aria-label="Fechar">✕</button>
        </div>

        {carregando ? <p className="texto-suave">Buscando as informações na Cloudbeds…</p> : !dados ? (
          erro && <div className="aviso-erro">{erro}</div>
        ) : (
          <>
            <p className="texto-suave" style={{ fontSize: 14 }}>
              As vendas <strong>avulsas</strong> da Conveniência e os pagamentos da <strong>Sala de Reunião</strong> vão
              para uma <strong>Conta da Casa</strong> na Cloudbeds. Assim tudo aparece no caixa da Cloudbeds e o
              Fechamento de Caixa conta cada pagamento uma vez só.
            </p>
            {dados.avisoCloudbeds && <div className="aviso-erro">{dados.avisoCloudbeds}</div>}

            <h3 className="cfg-titulo">1. Formas de pagamento</h3>
            <p className="texto-suave cfg-sub">Para cada forma do sistema, escolha a forma correspondente na Cloudbeds.</p>
            {Object.entries(dados.formasSistema).map(([chave, nome]) => {
              const atual = formas[chave];
              const metodo = atual && listaFormas.find((f) => f.codigo === atual.codigo);
              return (
                <div key={chave} className="cfg-linha">
                  <span className="cfg-rotulo">{nome}</span>
                  <div className="cfg-campo">
                    {listaFormas.length ? (
                      <select className="campo" value={atual?.codigo || ''} onChange={(e) => escolherForma(chave, e.target.value)}>
                        <option value="">— escolha na lista da Cloudbeds —</option>
                        {listaFormas.map((f) => <option key={f.codigo} value={f.codigo}>{f.nome}</option>)}
                        {atual?.codigo && !metodo && <option value={atual.codigo}>{atual.nome || atual.codigo} (salva)</option>}
                      </select>
                    ) : (
                      <input
                        className="campo"
                        placeholder="Código da forma na Cloudbeds (ex.: cash)"
                        value={atual?.codigo || ''}
                        onChange={(e) => setFormas((a) => ({ ...a, [chave]: e.target.value ? { codigo: e.target.value, metodo: e.target.value, nome: e.target.value, cartao: null } : null }))}
                      />
                    )}
                    {precisaCartao(atual) && (
                      <select
                        className="campo"
                        style={{ marginTop: 6 }}
                        value={atual?.cartao || ''}
                        onChange={(e) => setFormas((a) => ({ ...a, [chave]: { ...a[chave], cartao: e.target.value || null } }))}
                      >
                        <option value="">— bandeira do cartão —</option>
                        {metodo.cartoes.map((c) => <option key={c.codigo} value={c.codigo}>{c.nome}</option>)}
                      </select>
                    )}
                  </div>
                </div>
              );
            })}

            <h3 className="cfg-titulo">2. Contas da Casa</h3>
            <div className="cfg-linha">
              <span className="cfg-rotulo">Conveniência (vendas avulsas)</span>
              {seletorConta('conta_pdv_id', 'conta_pdv_nome', dados.nomesPadrao.pdv)}
            </div>
            <div className="cfg-linha">
              <span className="cfg-rotulo">Sala de Reunião</span>
              {seletorConta('conta_sala_id', 'conta_sala_nome', dados.nomesPadrao.sala)}
            </div>

            <h3 className="cfg-titulo">3. Envio automático</h3>
            <label className="cfg-check">
              <input type="checkbox" checked={enviar.enviar_pdv} onChange={(e) => setEnviar((a) => ({ ...a, enviar_pdv: e.target.checked }))} />
              Enviar as vendas avulsas da Conveniência para a Cloudbeds
            </label>
            <label className="cfg-check">
              <input type="checkbox" checked={enviar.enviar_sala} onChange={(e) => setEnviar((a) => ({ ...a, enviar_sala: e.target.checked }))} />
              Enviar os pagamentos da Sala de Reunião para a Cloudbeds
            </label>

            {erro && <div className="aviso-erro" style={{ marginTop: 12 }}>{erro}</div>}
            {aviso && <div className="aviso-sucesso" style={{ marginTop: 12 }}>{aviso}</div>}

            <div className="cfg-botoes">
              <button type="button" className="botao botao-principal" onClick={salvar} disabled={salvando}>
                {salvando ? 'Salvando…' : '💾 Salvar configuração'}
              </button>
              <button type="button" className="botao botao-suave" onClick={onFechar}>Fechar</button>
            </div>
          </>
        )}
      </div>
      <style>{`
        .cfg-overlay { position: fixed; inset: 0; z-index: 80; background: rgba(20, 30, 27, 0.55); display: flex; align-items: flex-end; justify-content: center; }
        .cfg-modal { background: var(--branco); width: 100%; max-height: 92vh; overflow-y: auto; border-radius: 18px 18px 0 0; padding: 18px 16px 24px; }
        .cfg-topo { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-bottom: 8px; }
        .cfg-titulo { font-size: 16px; margin: 18px 0 4px; }
        .cfg-sub { font-size: 13px; margin: 0 0 6px; }
        .cfg-linha { display: flex; flex-direction: column; gap: 4px; padding: 8px 0; border-bottom: 1px solid var(--borda); }
        .cfg-rotulo { font-weight: 600; font-size: 14px; }
        .cfg-campo { flex: 1; min-width: 0; }
        .cfg-check { display: flex; gap: 8px; align-items: center; font-size: 14px; margin: 8px 0; }
        .cfg-check input { width: 18px; height: 18px; accent-color: var(--marca); }
        .cfg-botoes { display: flex; gap: 10px; flex-wrap: wrap; margin-top: 16px; }
        @media (min-width: 640px) {
          .cfg-overlay { align-items: center; padding: 24px; }
          .cfg-modal { max-width: 640px; border-radius: 18px; padding: 24px; }
          .cfg-linha { flex-direction: row; align-items: center; }
          .cfg-rotulo { width: 220px; flex-shrink: 0; }
        }
      `}</style>
    </div>
  );
}
