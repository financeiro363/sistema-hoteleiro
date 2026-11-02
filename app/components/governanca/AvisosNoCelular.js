'use client';

// ============================================================================
// GOVERNANÇA → Camareira → "Avisos no celular"
// Liga os avisos (Web Push) neste celular: pede permissão, registra o
// /sw.js, inscreve com a chave pública do hotel e manda para /api/push.
// No iPhone só funciona com o sistema aberto pelo ícone da tela de início
// (Compartilhar → Adicionar à Tela de Início), iOS 16.4 ou mais novo.
// ============================================================================

import { useEffect, useState } from 'react';
import { chamarRota } from './rota';

function chaveParaBytes(base64) {
  const preenchido = (base64 + '='.repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/');
  const bruto = atob(preenchido);
  return Uint8Array.from([...bruto].map((c) => c.charCodeAt(0)));
}

function ehIphone() {
  return /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}
function instalado() {
  return window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone === true;
}

export default function AvisosNoCelular() {
  const [situacao, setSituacao] = useState('carregando'); // carregando | sem-suporte | iphone-instalar | desligado | negado | ligado
  const [ocupado, setOcupado] = useState(false);
  const [mensagem, setMensagem] = useState('');

  useEffect(() => {
    let ativo = true;
    (async () => {
      const suporta = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
      if (!suporta) { if (ativo) setSituacao(ehIphone() && !instalado() ? 'iphone-instalar' : 'sem-suporte'); return; }
      if (Notification.permission === 'denied') { if (ativo) setSituacao('negado'); return; }
      try {
        const registro = await navigator.serviceWorker.register('/sw.js');
        const inscricao = await registro.pushManager.getSubscription();
        if (inscricao && Notification.permission === 'granted') {
          // Confirma no servidor (o celular pode ter trocado de hotel ou de usuário)
          await chamarRota('/api/push', { acao: 'inscrever', inscricao: inscricao.toJSON() });
          if (ativo) setSituacao('ligado');
        } else if (ativo) setSituacao('desligado');
      } catch (e) { if (ativo) setSituacao('desligado'); }
    })();
    return () => { ativo = false; };
  }, []);

  async function ligar() {
    setOcupado(true); setMensagem('');
    try {
      const permissao = await Notification.requestPermission();
      if (permissao !== 'granted') { setSituacao(permissao === 'denied' ? 'negado' : 'desligado'); setOcupado(false); return; }
      const { ok, chavePublica, erro } = await chamarRota('/api/push');
      if (!ok || !chavePublica) throw new Error(erro || 'O servidor não mandou a chave dos avisos.');
      const registro = await navigator.serviceWorker.register('/sw.js');
      await navigator.serviceWorker.ready;
      let inscricao = await registro.pushManager.getSubscription();
      if (inscricao) { // chave antiga: começa do zero
        await chamarRota('/api/push', { acao: 'cancelar', endpoint: inscricao.endpoint });
        await inscricao.unsubscribe().catch(() => null);
      }
      inscricao = await registro.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: chaveParaBytes(chavePublica) });
      const r = await chamarRota('/api/push', { acao: 'inscrever', inscricao: inscricao.toJSON() });
      if (!r.ok) throw new Error(r.erro);
      setSituacao('ligado');
      setMensagem('✅ Pronto! Os pedidos da recepção vão chegar como notificação neste celular.');
    } catch (e) {
      setMensagem('⚠️ Não foi possível ligar os avisos: ' + (e.message || 'erro desconhecido'));
    }
    setOcupado(false);
  }

  async function testar() {
    setOcupado(true); setMensagem('');
    const r = await chamarRota('/api/push', { acao: 'testar' });
    setOcupado(false);
    setMensagem(r.ok ? '📨 Aviso de teste enviado — deve aparecer em alguns segundos.' : `⚠️ ${r.erro}`);
  }

  async function desligar() {
    setOcupado(true); setMensagem('');
    try {
      const registro = await navigator.serviceWorker.getRegistration('/sw.js');
      const inscricao = registro && await registro.pushManager.getSubscription();
      if (inscricao) {
        await chamarRota('/api/push', { acao: 'cancelar', endpoint: inscricao.endpoint });
        await inscricao.unsubscribe().catch(() => null);
      }
      setSituacao('desligado');
      setMensagem('Avisos desligados neste celular.');
    } catch (e) { setMensagem('⚠️ Não foi possível desligar.'); }
    setOcupado(false);
  }

  if (situacao === 'carregando') return null;

  if (situacao === 'ligado') {
    return (
      <div className="gc-avisos gc-avisos-ligado">
        <span>🔔 Avisos ligados neste celular</span>
        <span className="gc-avisos-acoes">
          <button type="button" onClick={testar} disabled={ocupado}>Testar</button>
          <button type="button" onClick={desligar} disabled={ocupado}>Desligar</button>
        </span>
        {mensagem && <p className="gc-avisos-msg">{mensagem}</p>}
        <EstilosAvisos />
      </div>
    );
  }

  return (
    <div className="cartao gc-avisos">
      <strong>🔔 Avisos no celular</strong>
      {situacao === 'desligado' && (
        <>
          <p>Ligue para receber na hora os pedidos da recepção (toalha extra, travesseiro…), mesmo com a tela apagada.</p>
          <button type="button" className="botao botao-principal gc-avisos-botao" onClick={ligar} disabled={ocupado}>
            {ocupado ? 'Ligando…' : '🔔 Ativar avisos neste celular'}
          </button>
        </>
      )}
      {situacao === 'negado' && (
        <p>Os avisos estão <strong>bloqueados</strong> neste celular. Abra as configurações do navegador → Notificações → libere este site e recarregue a página.</p>
      )}
      {situacao === 'iphone-instalar' && (
        <ol className="gc-avisos-passos">
          <li>Abra este site no <strong>Safari</strong>.</li>
          <li>Toque em <strong>Compartilhar</strong> (quadrado com seta para cima) → <strong>Adicionar à Tela de Início</strong>.</li>
          <li>Abra o sistema pelo <strong>ícone novo</strong> na tela de início, entre na Governança e toque em &quot;Ativar avisos&quot;.</li>
        </ol>
      )}
      {situacao === 'sem-suporte' && (
        <p>Este navegador não recebe avisos. No Android use o <strong>Chrome</strong>; no iPhone, iOS 16.4 ou mais novo com o sistema instalado na tela de início.</p>
      )}
      {mensagem && <p className="gc-avisos-msg">{mensagem}</p>}
      <EstilosAvisos />
    </div>
  );
}

function EstilosAvisos() {
  return (
    <style>{`
      .gc-avisos { margin-bottom: 12px; font-size: 14px; }
      .gc-avisos p { margin: 6px 0 0; font-size: 13px; color: var(--texto-suave); }
      .gc-avisos-botao { width: 100%; margin-top: 10px; min-height: 52px; font-size: 16px; }
      .gc-avisos-ligado { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 6px; background: var(--marca-clara); color: var(--marca); border-radius: 12px; padding: 8px 12px; font-weight: 600; }
      .gc-avisos-acoes { display: flex; gap: 6px; }
      .gc-avisos-acoes button { background: var(--branco); border: 1px solid var(--borda); border-radius: 8px; padding: 6px 10px; font-size: 13px; font-weight: 600; cursor: pointer; color: var(--tinta); font-family: inherit; }
      .gc-avisos-msg { width: 100%; font-weight: 400; }
      .gc-avisos-passos { margin: 8px 0 0; padding-left: 20px; font-size: 13px; display: flex; flex-direction: column; gap: 4px; }
    `}</style>
  );
}
