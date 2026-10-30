'use client';

// ============================================================================
// DOCUMENTOS DOS COLABORADORES (Administração) — SÓ ADMIN
// ============================================================================
// Duas abas:
//   - Recebimento de documentos (contracheque por e-mail, folha de ponto,
//     folha de alimentação, banco de horas) → components/documentos/RecebimentoDocumentos.js
//   - Fichas de EPI → components/documentos/FichasEpi.js
// A aba fica no endereço (?aba=epi), para voltar direto nela.
// ============================================================================

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '../../lib/supabaseClient';
import { bloquearSeNaoPermitido } from '../../lib/restricaoAcesso';
import RecebimentoDocumentos from '../components/documentos/RecebimentoDocumentos';
import FichasEpi from '../components/documentos/FichasEpi';

const ABAS = [
  { chave: 'recebimento', rotulo: '📄 Recebimento', resto: ' de documentos' },
  { chave: 'epi', rotulo: '🦺 Fichas de EPI', resto: '' },
];

export default function DocumentosColaboradoresPagina() {
  const router = useRouter();
  const [usuario, setUsuario] = useState(null);
  const [aba, setAba] = useState(null);

  useEffect(() => {
    const pedida = new URLSearchParams(window.location.search).get('aba');
    setAba(ABAS.some((a) => a.chave === pedida) ? pedida : 'recebimento');
  }, []);

  // ---- Acesso: só ADMIN ----------------------------------------------------
  useEffect(() => {
    let ativo = true;
    async function verificar() {
      const { data: sessao } = await supabase.auth.getSession();
      if (!sessao?.session) { router.push('/login'); return; }
      const { data: dadosUsuario, error } = await supabase
        .from('usuarios').select('*').eq('auth_id', sessao.session.user.id).single();
      if (error || !dadosUsuario) { router.push('/login'); return; }
      if (bloquearSeNaoPermitido(dadosUsuario.papel, router)) return;
      if (dadosUsuario.papel !== 'ADMIN') { router.push('/'); return; }
      if (ativo) setUsuario(dadosUsuario);
    }
    verificar();
    return () => { ativo = false; };
  }, [router]);

  function trocarAba(chave) {
    setAba(chave);
    const url = new URL(window.location.href);
    if (chave === 'recebimento') url.searchParams.delete('aba'); else url.searchParams.set('aba', chave);
    window.history.replaceState(null, '', url.pathname + url.search);
  }

  if (!usuario || !aba) {
    return (
      <main className="conteudo">
        <p className="texto-suave">Verificando seu acesso…</p>
      </main>
    );
  }

  return (
    <main className="conteudo">
      <span className="olho">Administração</span>
      <h1 style={{ margin: '0 0 12px' }}>Documentos dos Colaboradores</h1>
      <div className="dc-abas" role="tablist" aria-label="Documentos dos Colaboradores">
        {ABAS.map((a) => (
          <button key={a.chave} type="button" role="tab" aria-selected={aba === a.chave}
            className={aba === a.chave ? 'dc-aba dc-aba-ativa' : 'dc-aba'} onClick={() => trocarAba(a.chave)}>
            {a.rotulo}{a.resto && <span className="dc-aba-resto">{a.resto}</span>}
          </button>
        ))}
      </div>
      {aba === 'recebimento' ? <RecebimentoDocumentos usuario={usuario} /> : <FichasEpi usuario={usuario} />}
      <style>{`
        .dc-abas { display: flex; gap: 4px; border-bottom: 2px solid var(--borda); margin-bottom: 16px; overflow-x: auto; }
        .dc-aba { flex: none; border: none; background: none; color: var(--texto-suave); font: inherit; font-weight: 600; font-size: 15px; padding: 10px 14px; border-bottom: 3px solid transparent; margin-bottom: -2px; cursor: pointer; white-space: nowrap; }
        .dc-aba-ativa { color: var(--marca); border-bottom-color: var(--marca); }
        @media (max-width: 520px) { .dc-aba-resto { display: none; } .dc-aba { padding: 10px 10px; } }
        .dc-barra-aba { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; justify-content: space-between; margin-bottom: 12px; }
        .dc-titulo-aba { margin: 0; font-size: 20px; min-width: 0; overflow-wrap: anywhere; }

        .fe-filtros { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 12px; }
        .fe-filtro { border: 1px solid var(--borda); background: var(--branco); color: inherit; border-radius: 999px; padding: 7px 14px; font: inherit; font-size: 14px; cursor: pointer; }
        .fe-filtro-ativo { background: var(--marca); border-color: var(--marca); color: #fff; }
        .fe-conta { display: inline-block; min-width: 20px; padding: 0 6px; margin-left: 4px; border-radius: 999px; background: rgba(0,0,0,0.08); font-size: 12.5px; text-align: center; }
        .fe-filtro-ativo .fe-conta { background: rgba(255,255,255,0.25); }
        .fe-botoes { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; }
      `}</style>
    </main>
  );
}
