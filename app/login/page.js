'use client';

// ============================================================================
// PÁGINA DE LOGIN
// Autenticação real via Supabase Authentication (e-mail + senha).
// ============================================================================

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '../../lib/supabaseClient';

// Traduz as mensagens de erro mais comuns do Supabase para português claro
function traduzirErro(mensagem) {
  const texto = (mensagem || '').toLowerCase();
  if (texto.includes('invalid login credentials')) {
    return 'E-mail ou senha incorretos. Confira e tente de novo.';
  }
  if (texto.includes('email not confirmed')) {
    return 'Este e-mail ainda não foi confirmado. Verifique sua caixa de entrada.';
  }
  if (texto.includes('network') || texto.includes('fetch')) {
    return 'Falha de conexão. Verifique sua internet e tente novamente.';
  }
  return 'Não foi possível entrar. Detalhe técnico: ' + mensagem;
}

export default function PaginaLogin() {
  const router = useRouter();

  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [mostrarSenha, setMostrarSenha] = useState(false);
  const [entrando, setEntrando] = useState(false);
  const [erro, setErro] = useState('');

  async function entrar(evento) {
    evento.preventDefault();
    if (entrando) return;
    setErro('');

    if (!email.trim() || !senha) {
      setErro('Preencha o e-mail e a senha.');
      return;
    }

    setEntrando(true);
    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password: senha,
    });

    if (error) {
      setEntrando(false);
      setErro(traduzirErro(error.message));
      return;
    }

    // Confere se o acesso dessa pessoa não foi desativado pelo admin
    const { data: sessao } = await supabase.auth.getSession();
    const { data: perfil } = await supabase
      .from('usuarios').select('ativo').eq('auth_id', sessao.session.user.id).single();
    setEntrando(false);

    if (perfil && perfil.ativo === false) {
      await supabase.auth.signOut();
      setErro('Seu acesso foi desativado. Fale com o administrador do hotel.');
      return;
    }

    router.push('/');
  }

  return (
    <main className="conteudo">
      <div className="caixa-login">
        <div className="cartao">
          <span className="olho">Acesso restrito</span>
          <h1 style={{ fontSize: '1.7rem' }}>Entrar no sistema</h1>
          <p className="texto-suave">
            Use o e-mail e a senha cadastrados para o seu hotel.
          </p>

          <form onSubmit={entrar}>
            <label className="rotulo" htmlFor="campo-email">E-mail</label>
            <input
              id="campo-email"
              className="campo"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="voce@seuhotel.com.br"
            />

            <label className="rotulo" htmlFor="campo-senha">Senha</label>
            <input
              id="campo-senha"
              className="campo"
              type={mostrarSenha ? 'text' : 'password'}
              autoComplete="current-password"
              value={senha}
              onChange={(e) => setSenha(e.target.value)}
              placeholder="Sua senha"
            />
            <label
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                marginTop: 8,
                fontSize: 14,
                cursor: 'pointer',
              }}
            >
              <input
                type="checkbox"
                checked={mostrarSenha}
                onChange={() => setMostrarSenha(!mostrarSenha)}
                style={{ width: 17, height: 17 }}
              />
              Mostrar senha
            </label>

            {erro && <div className="aviso-erro">{erro}</div>}

            <button
              type="submit"
              className="botao botao-principal"
              disabled={entrando}
              style={{ width: '100%', marginTop: 18 }}
            >
              {entrando ? 'Entrando…' : 'Entrar'}
            </button>
          </form>

          <p className="texto-suave" style={{ fontSize: 13, marginTop: 16, marginBottom: 0 }}>
            Esqueceu a senha ou ainda não tem acesso? Fale com o administrador do seu hotel.
          </p>
        </div>
      </div>
    </main>
  );
}
