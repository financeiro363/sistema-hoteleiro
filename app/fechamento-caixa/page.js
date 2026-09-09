'use client';

// ============================================================================
// FECHAMENTO DE CAIXA
// ============================================================================
// ⚠️ MODO DIAGNÓSTICO: a exibição dos dados ainda está crua (JSON), porque
// ainda estamos confirmando com a Cloudbeds os nomes exatos dos campos de
// forma de pagamento específica. A permissão e a trava de data JÁ SÃO a
// versão definitiva — só a tabela bonita com os totais por forma de
// pagamento e o layout de impressão faltam vir depois.
// ============================================================================

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '../../lib/supabaseClient';
import { bloquearSeNaoPermitido } from '../../lib/restricaoAcesso';

function hojeISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function ontemISO() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export default function FechamentoCaixa() {
  const router = useRouter();
  const [verificandoLogin, setVerificandoLogin] = useState(true);
  const [usuario, setUsuario] = useState(null);

  const [data, setData] = useState(hojeISO());
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState('');
  const [resultado, setResultado] = useState(null);

  useEffect(() => {
    let ativo = true;
    async function verificar() {
      const { data: sessao } = await supabase.auth.getSession();
      if (!sessao?.session) { router.push('/login'); return; }
      const { data: dadosUsuario, error } = await supabase
        .from('usuarios').select('*').eq('auth_id', sessao.session.user.id).single();
      if (error || !dadosUsuario) { router.push('/login'); return; }
      if (!ativo) return;
      setUsuario(dadosUsuario);
      if (bloquearSeNaoPermitido(dadosUsuario.papel, router)) return;
      setVerificandoLogin(false);
    }
    verificar();
    return () => { ativo = false; };
  }, [router]);

  async function buscar(dataParaBuscar) {
    setCarregando(true);
    setErro('');
    setResultado(null);
    const { data: sessao } = await supabase.auth.getSession();
    try {
      const resposta = await fetch(`/api/fechamento-caixa-listar?data=${dataParaBuscar}`, {
        headers: { Authorization: `Bearer ${sessao.session.access_token}` },
      });
      const resultadoJson = await resposta.json();
      setCarregando(false);
      if (!resposta.ok || resultadoJson.erro) { setErro(resultadoJson.erro || 'Não foi possível buscar.'); return; }
      setResultado(resultadoJson);
    } catch (e) {
      setCarregando(false);
      setErro('Falha de conexão com o servidor.');
    }
  }

  if (verificandoLogin) {
    return <main className="conteudo"><p className="texto-suave">Verificando seu acesso…</p></main>;
  }

  const souAdmin = usuario.papel === 'ADMIN';

  if (!souAdmin && !usuario.pode_acessar_fechamento_caixa) {
    return (
      <main className="conteudo">
        <span className="olho">Operações</span>
        <h1>Fechamento de Caixa</h1>
        <div className="cartao" style={{ textAlign: 'center', color: 'var(--texto-suave)' }}>
          Você ainda não tem permissão pra acessar o Fechamento de Caixa. Peça pro administrador
          liberar em Administração → Usuários.
        </div>
      </main>
    );
  }

  const dataMinimaColaborador = ontemISO();

  return (
    <main className="conteudo" style={{ maxWidth: 800 }}>
      <span className="olho">Operações</span>
      <h1>Fechamento de Caixa</h1>

      <div style={{ background: '#FDF3D7', color: '#8A6100', borderRadius: 10, padding: '10px 14px', fontSize: 13, marginBottom: 14 }}>
        🧪 <strong>Modo diagnóstico</strong> — a exibição ainda está em formato bruto (JSON), enquanto
        confirmamos com a Cloudbeds os nomes exatos de cada forma de pagamento. A tabela organizada
        e a impressão vêm na próxima etapa.
      </div>

      <div className="cartao" style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <div>
          <label className="rotulo">Data</label>
          <input className="campo" type="date" value={data}
            min={souAdmin ? undefined : dataMinimaColaborador}
            max={souAdmin ? undefined : hojeISO()}
            onChange={(e) => setData(e.target.value)} />
        </div>
        <button type="button" className="botao botao-principal" onClick={() => buscar(data)} disabled={carregando}>
          {carregando ? 'Buscando…' : 'Buscar'}
        </button>
        {!souAdmin && (
          <span className="texto-suave" style={{ fontSize: 12 }}>Você só pode consultar hoje ou ontem.</span>
        )}
      </div>

      {erro && <div className="aviso-erro" style={{ marginTop: 14 }}>{erro}</div>}

      {resultado && (
        <div className="cartao" style={{ marginTop: 14 }}>
          <p><strong>Data consultada:</strong> {resultado.data}</p>
          <p><strong>Total de transações encontradas (todas):</strong> {resultado.totalBruto}</p>
          <p><strong>Transações de pagamento/estorno:</strong> {resultado.transacoesPagamentoEEstorno?.length ?? 0}</p>
          <details open>
            <summary style={{ cursor: 'pointer', fontWeight: 600, marginBottom: 8 }}>Ver resposta bruta da Cloudbeds</summary>
            <pre style={{ fontSize: 11, overflowX: 'auto', background: '#F7F8F6', padding: 10, borderRadius: 8 }}>
              {JSON.stringify(resultado, null, 2)}
            </pre>
          </details>
        </div>
      )}
    </main>
  );
}
