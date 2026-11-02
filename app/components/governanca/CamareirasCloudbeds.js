'use client';

// ============================================================================
// GOVERNANÇA → Configurações → "Camareiras na Cloudbeds" (só ADMIN)
// Liga cada camareira daqui à camareira ("housekeeper") cadastrada na
// Cloudbeds. Com a ligação feita, a distribuição do Painel avisa a Cloudbeds
// quem ficou com cada quarto. Sugere pelo primeiro nome (sem acento).
// ============================================================================

import { useState } from 'react';
import { supabase } from '../../../lib/supabaseClient';

const semAcento = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

async function chamar(corpo) {
  const { data: sessao } = await supabase.auth.getSession();
  const resposta = await fetch('/api/governanca-camareiras-cloudbeds', {
    method: corpo ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sessao.session.access_token}` },
    ...(corpo ? { body: JSON.stringify(corpo) } : {}),
  });
  const r = await resposta.json().catch(() => ({}));
  return { ok: resposta.ok && !r.erro, ...r };
}

export default function CamareirasCloudbeds({ camareiras, mostrarAviso }) {
  const [housekeepers, setHousekeepers] = useState(null);
  const [escolhas, setEscolhas] = useState({});
  const [carregando, setCarregando] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState('');

  async function carregar() {
    setCarregando(true); setErro('');
    const r = await chamar(null).catch(() => ({ ok: false, erro: 'Falha de conexão.' }));
    setCarregando(false);
    const mapa = Object.fromEntries((r.mapa || []).map((m) => [m.usuario_id, m.housekeeper_id]));
    if (!r.ok) { setErro(r.erro || 'Não foi possível consultar a Cloudbeds.'); setEscolhas(mapa); return; }
    const lista = r.housekeepers || [];
    // Sugestão pelo primeiro nome, para quem ainda não tem ligação
    const sugeridas = { ...mapa };
    for (const c of camareiras) {
      if (sugeridas[c.id]) continue;
      const primeiro = semAcento(c.nome).split(' ')[0];
      const iguais = lista.filter((h) => semAcento(h.nome).split(' ')[0] === primeiro);
      if (primeiro && iguais.length === 1) sugeridas[c.id] = iguais[0].id;
    }
    setHousekeepers(lista);
    setEscolhas(sugeridas);
  }

  async function salvar() {
    setSalvando(true); setErro('');
    const mapa = camareiras.map((c) => {
      const id = escolhas[c.id] || '';
      return { usuarioId: c.id, housekeeperId: id, housekeeperNome: (housekeepers || []).find((h) => h.id === id)?.nome || null };
    });
    const r = await chamar({ acao: 'salvar', mapa }).catch(() => ({ ok: false, erro: 'Falha de conexão.' }));
    setSalvando(false);
    if (!r.ok) { setErro(r.erro || 'Não foi possível salvar.'); return; }
    mostrarAviso('Ligação das camareiras com a Cloudbeds salva!');
  }

  return (
    <div className="cartao" style={{ maxWidth: 560, marginTop: 14 }}>
      <h2 style={{ fontSize: '1.1rem', marginTop: 0 }}>🧹 Camareiras na Cloudbeds</h2>
      <p className="texto-suave" style={{ fontSize: 13 }}>
        Ligue cada camareira daqui à mesma pessoa cadastrada na Cloudbeds (em Housekeeping). Com isso, quando a
        governanta distribuir os quartos no Painel, a Cloudbeds também mostra quem ficou com cada quarto.
      </p>
      {camareiras.length === 0 ? (
        <p className="texto-suave" style={{ fontSize: 13 }}>Nenhum usuário com o perfil &quot;Camareira&quot; neste hotel.</p>
      ) : housekeepers === null ? (
        <button type="button" className="botao botao-suave" onClick={carregar} disabled={carregando}>
          {carregando ? 'Buscando…' : '🔄 Carregar camareiras da Cloudbeds'}
        </button>
      ) : (
        <>
          {housekeepers.length === 0 && (
            <p className="texto-suave" style={{ fontSize: 13 }}>A Cloudbeds não tem camareiras cadastradas. Cadastre lá em Housekeeping e carregue de novo.</p>
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {camareiras.map((c) => (
              <label key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <span style={{ minWidth: 150, fontWeight: 600, fontSize: 14 }}>{c.nome}</span>
                <select className="campo" style={{ flex: 1, minWidth: 180 }} value={escolhas[c.id] || ''}
                  onChange={(e) => setEscolhas({ ...escolhas, [c.id]: e.target.value })} aria-label={`Camareira na Cloudbeds para ${c.nome}`}>
                  <option value="">— Não ligar —</option>
                  {housekeepers.map((h) => <option key={h.id} value={h.id}>{h.nome}</option>)}
                </select>
              </label>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
            <button type="button" className="botao botao-principal" onClick={salvar} disabled={salvando}>{salvando ? 'Salvando…' : 'Salvar ligação'}</button>
            <button type="button" className="botao botao-suave" onClick={carregar} disabled={carregando}>{carregando ? 'Buscando…' : 'Carregar de novo'}</button>
          </div>
        </>
      )}
      {erro && <div className="aviso-erro" style={{ marginTop: 10 }}>{erro}</div>}
    </div>
  );
}
