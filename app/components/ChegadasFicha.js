'use client';

// ============================================================================
// FICHAS DE HÓSPEDES → "Chegadas: quem já preencheu a ficha" (M1)
// Chegadas de hoje e dos próximos 2 dias na Cloudbeds, com ✅ ficha ok ou
// ⏳ falta. Só nome e data (rota /api/fichas-chegadas). Para a recepção saber
// quem ainda precisa preencher na chegada.
// ============================================================================

import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../../lib/supabaseClient';

const diaBR = (iso) => { const [a, m, d] = String(iso).split('-'); return `${d}/${m}`; };
const hojeISO = (dias = 0) => new Date(Date.now() + dias * 86400000).toLocaleDateString('en-CA', { timeZone: 'America/Fortaleza' });
function rotuloDia(iso) {
  if (iso === hojeISO()) return `Hoje (${diaBR(iso)})`;
  if (iso === hojeISO(1)) return `Amanhã (${diaBR(iso)})`;
  return diaBR(iso);
}

export default function ChegadasFicha() {
  const [dados, setDados] = useState(null);
  const [erro, setErro] = useState('');
  const [carregando, setCarregando] = useState(true);

  const carregar = useCallback(async () => {
    setCarregando(true); setErro('');
    try {
      const { data: s } = await supabase.auth.getSession();
      const r = await fetch('/api/fichas-chegadas', { headers: { Authorization: `Bearer ${s?.session?.access_token || ''}` } });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.erro || 'Não foi possível buscar as chegadas.');
      setDados(j);
    } catch (e) { setErro(e.message); }
    setCarregando(false);
  }, []);

  useEffect(() => { carregar(); }, [carregar]);

  const lista = dados?.chegadas || [];
  const faltam = lista.filter((c) => !c.ficha).length;
  const dias = [...new Set(lista.map((c) => c.checkin))];

  return (
    <div className="cartao cf-bloco">
      <div className="cf-cabeca">
        <h2>🧳 Chegadas: quem já preencheu a ficha</h2>
        <button type="button" className="botao botao-suave" onClick={carregar} disabled={carregando}>{carregando ? 'Buscando na Cloudbeds…' : '🔄 Atualizar'}</button>
      </div>
      {erro && <p className="cf-erro">⚠️ {erro}</p>}
      {dados && !lista.length && <p className="texto-suave">Nenhuma chegada de hoje até {diaBR(dados.ate)}.</p>}
      {lista.length > 0 && (
        <p className="texto-suave cf-resumo">
          {lista.length} chegada(s) · <strong>{lista.length - faltam} com ficha</strong> · {faltam ? <strong className="cf-falta-txt">{faltam} sem ficha</strong> : 'nenhuma faltando'}
        </p>
      )}
      {dias.map((d) => (
        <div key={d} className="cf-dia">
          <strong>{rotuloDia(d)}</strong>
          <ul>
            {lista.filter((c) => c.checkin === d).map((c, i) => (
              <li key={`${d}-${i}`} className={c.ficha ? 'cf-ok' : 'cf-falta'}>
                <span>{c.ficha ? '✅' : '⏳'}</span>
                <span className="cf-nome">{c.nome || '(sem nome)'}</span>
                <span className="cf-sit">{c.ficha ? 'ficha ok' : 'falta a ficha'}{c.jaChegou ? ' · já fez check-in' : ''}</span>
              </li>
            ))}
          </ul>
        </div>
      ))}
      <p className="texto-suave cf-nota">
        A ficha é reconhecida pelo link enviado na mensagem automática, pelo nº da reserva ou pelo nome + data de entrada.
        Quem preencheu com outro nome pode aparecer como “falta”.
      </p>
      <style>{`
        .cf-bloco { margin-top: 14px; }
        .cf-cabeca { display: flex; justify-content: space-between; align-items: center; gap: 10px; flex-wrap: wrap; }
        .cf-cabeca h2 { font-size: 16px; margin: 0; }
        .cf-resumo { margin: 8px 0 4px; font-size: 13px; }
        .cf-falta-txt { color: #8A6100; }
        .cf-dia { border-top: 1px solid var(--borda); padding: 8px 0; }
        .cf-dia ul { list-style: none; margin: 6px 0 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }
        .cf-dia li { display: flex; gap: 8px; align-items: baseline; font-size: 14px; flex-wrap: wrap; }
        .cf-nome { font-weight: 600; }
        .cf-sit { font-size: 12px; color: var(--texto-suave); }
        .cf-falta .cf-sit { color: #8A6100; }
        .cf-erro { font-size: 13px; color: #A31212; margin: 6px 0 0; }
        .cf-nota { font-size: 12px; margin: 6px 0 0; }
      `}</style>
    </div>
  );
}
