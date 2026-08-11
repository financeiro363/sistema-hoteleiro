'use client';

// ============================================================================
// REDEFINIR SENHA
// Para onde o link do e-mail de recuperação leva. O Supabase, ao carregar
// esta página com o link certo, já autentica a pessoa temporariamente (só
// para poder trocar a senha) — por isso escutamos o evento PASSWORD_RECOVERY
// e também conferimos a sessão diretamente, já que às vezes o evento
// dispara antes do componente terminar de montar.
// ============================================================================

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { supabase } from '../../lib/supabaseClient';

export default function RedefinirSenha() {
  const router = useRouter();

  const [verificando, setVerificando] = useState(true);
  const [linkValido, setLinkValido] = useState(false);
  const [novaSenha, setNovaSenha] = useState('');
  const [confirmarSenha, setConfirmarSenha] = useState('');
  const [mostrarSenha, setMostrarSenha] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [sucesso, setSucesso] = useState(false);
  const [erro, setErro] = useState('');

  useEffect(() => {
    let ativo = true;

    // Confere se já existe uma sessão válida (o link de recuperação já
    // pode ter autenticado a pessoa antes deste efeito rodar)
    supabase.auth.getSession().then(({ data }) => {
      if (ativo && data?.session) { setLinkValido(true); setVerificando(false); }
    });

    // E também escuta o evento, caso a sessão ainda não tivesse chegado
    const { data: escuta } = supabase.auth.onAuthStateChange((evento, sessao) => {
      if (!ativo) return;
      if (evento === 'PASSWORD_RECOVERY' || sessao) { setLinkValido(true); setVerificando(false); }
    });

    // Se depois de um tempinho nada chegou, o link deve estar
    // inválido/expirado — paramos de mostrar "verificando"
    const tempoLimite = setTimeout(() => { if (ativo) setVerificando(false); }, 4000);

    return () => {
      ativo = false;
      escuta?.subscription?.unsubscribe();
      clearTimeout(tempoLimite);
    };
  }, []);

  async function salvarNovaSenha(evento) {
    evento.preventDefault();
    if (salvando) return;
    setErro('');

    if (novaSenha.length < 6) {
      setErro('A senha precisa ter pelo menos 6 caracteres.');
      return;
    }
    if (novaSenha !== confirmarSenha) {
      setErro('As duas senhas digitadas são diferentes. Confira e tente de novo.');
      return;
    }

    setSalvando(true);
    const { error } = await supabase.auth.updateUser({ password: novaSenha });
    setSalvando(false);

    if (error) {
      setErro('Não foi possível salvar a nova senha. Detalhe técnico: ' + error.message);
      return;
    }

    setSucesso(true);
    await supabase.auth.signOut();
    setTimeout(() => router.push('/login'), 3000);
  }

  return (
    <main className="conteudo">
      <div className="caixa-login">
        <div className="cartao">
          <span className="olho">Acesso restrito</span>
          <h1 style={{ fontSize: '1.5rem' }}>Redefinir senha</h1>

          {verificando && <p className="texto-suave">Verificando o link, aguarde…</p>}

          {!verificando && !linkValido && !sucesso && (
            <>
              <div className="aviso-erro">
                Este link não é válido ou já expirou. Links de recuperação de senha valem só por
                um tempo limitado, por segurança.
              </div>
              <Link href="/esqueci-senha" className="botao botao-principal" style={{ display: 'block', textAlign: 'center', marginTop: 16 }}>
                Solicitar um novo link
              </Link>
            </>
          )}

          {!verificando && linkValido && !sucesso && (
            <>
              <p className="texto-suave">Escolha uma nova senha para entrar no sistema.</p>

              <form onSubmit={salvarNovaSenha}>
                <label className="rotulo" htmlFor="campo-nova-senha">Nova senha</label>
                <input
                  id="campo-nova-senha"
                  className="campo"
                  type={mostrarSenha ? 'text' : 'password'}
                  autoComplete="new-password"
                  value={novaSenha}
                  onChange={(e) => setNovaSenha(e.target.value)}
                  placeholder="Pelo menos 6 caracteres"
                />

                <label className="rotulo" htmlFor="campo-confirmar-senha">Confirme a nova senha</label>
                <input
                  id="campo-confirmar-senha"
                  className="campo"
                  type={mostrarSenha ? 'text' : 'password'}
                  autoComplete="new-password"
                  value={confirmarSenha}
                  onChange={(e) => setConfirmarSenha(e.target.value)}
                  placeholder="Digite de novo"
                />

                <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, fontSize: 14, cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={mostrarSenha}
                    onChange={() => setMostrarSenha(!mostrarSenha)}
                    style={{ width: 17, height: 17 }}
                  />
                  Mostrar senha
                </label>

                {erro && <div className="aviso-erro">{erro}</div>}

                <button type="submit" className="botao botao-principal" disabled={salvando} style={{ width: '100%', marginTop: 18 }}>
                  {salvando ? 'Salvando…' : 'Salvar nova senha'}
                </button>
              </form>
            </>
          )}

          {sucesso && (
            <div className="aviso-sucesso">
              Senha alterada com sucesso! Levando você para o login em instantes…
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
