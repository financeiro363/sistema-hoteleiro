'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '../lib/supabaseClient';

// ============================================================================
// PÁGINA INICIAL
// Apresenta o sistema e dá acesso rápido aos módulos já disponíveis.
// ============================================================================

const CATEGORIAS_MODULOS = [
  {
    chave: 'atendimento',
    nome: 'Atendimento',
    descricao: 'O dia a dia da recepção e do relacionamento com o hóspede.',
    modulos: [
      {
        href: '/agenda',
        titulo: 'Agenda Telefônica',
        descricao: 'Contatos importantes do hotel: fornecedores, serviços e equipe, sempre à mão.',
      },
      {
        href: '/solicitacoes',
        titulo: 'Solicitações',
        descricao: 'Delegue e acompanhe tarefas da equipe, como um e-mail interno com histórico completo.',
      },
      {
        href: '/lista-espera',
        titulo: 'Lista de Espera',
        descricao: 'Fila de prioridade de reservas, com confirmação automática por WhatsApp e e-mail.',
      },
      {
        href: '/creditos',
        titulo: 'Créditos e Devoluções',
        descricao: 'Pagamentos antecipados guardados e pedidos de reembolso (depósito, cartão ou Pix), com comprovantes.',
      },
      {
        href: '/achados-perdidos',
        titulo: 'Achados e Perdidos',
        descricao: 'Itens esquecidos com foto, fluxo antifraude de devolução e recibo para assinatura.',
      },
      {
        href: '/recibos',
        titulo: 'Recibos',
        descricao: 'Recibos de pagamento com valor por extenso, numeração automática e reimpressão rastreada.',
      },
      {
        href: '/fichas-hospedes',
        titulo: 'Fichas de Hóspedes',
        descricao: 'Ficha FNRH pública para o hóspede preencher e exportação dos dados para a reserva na Cloudbeds.',
      },
    ],
  },
  {
    chave: 'operacoes',
    nome: 'Operações',
    descricao: 'Os bastidores do hotel — do estoque à governança.',
    modulos: [
      {
        href: '/depositos',
        titulo: 'Depósitos Bancários',
        descricao: 'Conferência dos depósitos na conta do hotel, com importação de CSV, baixa por hóspede e estorno.',
      },
      {
        href: '/sala-reuniao',
        titulo: 'Sala de Reunião',
        descricao: 'Calendário semanal de reservas com contrato de locação automático para assinatura.',
      },
      {
        href: '/lavanderia',
        titulo: 'Lavanderia',
        descricao: 'Catálogo de preços, entrada de roupas com comprovante e acompanhamento do ciclo até a entrega.',
      },
      {
        href: '/ocorrencias',
        titulo: 'Ocorrências',
        descricao: 'Registro de incidentes por gravidade, com status, responsável e linha do tempo de andamentos.',
      },
      {
        href: '/manutencao',
        titulo: 'Manutenção',
        descricao: 'Chamados de reparo em quadro Kanban, com visão do técnico, indicadores e log completo.',
      },
      {
        href: '/estoque',
        titulo: 'Estoque',
        descricao: 'Dar baixa com carrinho, gerenciar produtos com alerta de mínimo e histórico completo.',
      },
      {
        href: '/governanca',
        titulo: 'Governança',
        descricao: 'Rotina das camareiras por quarto, com checklist, integração com Manutenção e Achados e Perdidos.',
      },
      {
        href: '/pdv',
        titulo: 'PDV — Conveniência',
        descricao: 'Venda rápida com leitor de código de barras, pagamento avulso ou lançamento na conta do quarto via Cloudbeds.',
      },
    ],
  },
  {
    chave: 'administracao',
    nome: 'Administração',
    descricao: 'Financeiro, folha de pagamento e controle de acesso — área restrita da equipe de gestão.',
    modulos: [
      {
        href: '/financeiro',
        titulo: 'Financeiro',
        descricao: 'Contas a pagar e receber, clientes, fornecedores, categorias e dashboard com fluxo de caixa. (Só admin)',
      },
      {
        href: '/ponto',
        titulo: 'Ponto',
        descricao: 'Folha de ponto e banco de horas conforme a CCT Sindhotel-PB, com alertas jurídicos. (Só admin)',
      },
      {
        href: '/contabilidade',
        titulo: 'Contabilidade',
        descricao: 'Lançamentos com link do Drive, extratos bancários por ano e log de auditoria. (Admin e Contador)',
      },
      {
        href: '/usuarios',
        titulo: 'Controle de Acesso',
        descricao: 'Ative, desative e defina o papel de cada usuário do sistema. (Só admin)',
      },
      {
        href: '/atestados',
        titulo: 'Atestados',
        descricao: 'Registro de atestados médicos/odontológicos com recibo em 2 vias. (Admin, Contador ou permissão especial)',
      },
    ],
  },
];

export default function PaginaInicial() {
  const router = useRouter();
  const [verificando, setVerificando] = useState(true);

  // Se quem está logado é Contador, manda direto para a Contabilidade —
  // ele não usa mais nada do resto do sistema.
  useEffect(() => {
    let ativo = true;
    async function verificar() {
      const { data: sessao } = await supabase.auth.getSession();
      if (!sessao?.session) { if (ativo) setVerificando(false); return; }
      const { data: perfil } = await supabase
        .from('usuarios').select('papel').eq('auth_id', sessao.session.user.id).single();
      if (!ativo) return;
      if (perfil?.papel === 'CONTADOR') { router.push('/contabilidade'); return; }
      setVerificando(false);
    }
    verificar();
    return () => { ativo = false; };
  }, [router]);

  if (verificando) {
    return <main className="conteudo"><p className="texto-suave">Carregando…</p></main>;
  }

  return (
    <main className="conteudo">
      {/* Hero: apresentação principal */}
      <section className="hero">
        <span className="olho">Gestão hoteleira</span>
        <h1>A recepção, os bastidores e as contas do seu hotel — num só lugar.</h1>
        <p className="hero-sub">
          Um sistema simples, feito para o dia a dia da equipe: cada hotel enxerga
          apenas os próprios dados, com segurança garantida no banco de dados.
        </p>
        <div className="hero-botoes">
          <Link href="/login" className="botao botao-principal">
            Entrar no sistema
          </Link>
          <a href="#modulos" className="botao botao-contorno">
            Ver módulos
          </a>
        </div>
      </section>

      {/* Módulos disponíveis, agrupados por área */}
      <section id="modulos" aria-labelledby="titulo-modulos">
        <h2 id="titulo-modulos">Módulos disponíveis</h2>
        <p className="texto-suave" style={{ maxWidth: 600, marginTop: -8 }}>
          Organizados do mesmo jeito que aparecem no menu do sistema, por área de uso.
        </p>

        {CATEGORIAS_MODULOS.map((categoria) => (
          <div key={categoria.chave} className="categoria-modulos">
            <span className="olho">{categoria.nome}</span>
            <p className="categoria-modulos-desc">{categoria.descricao}</p>
            <div className="grade-modulos">
              {categoria.modulos.map((m) => (
                <Link key={m.href} href={m.href} className="modulo">
                  <span className="modulo-etiqueta">Disponível</span>
                  <h3>{m.titulo}</h3>
                  <p>{m.descricao}</p>
                </Link>
              ))}
            </div>
          </div>
        ))}
      </section>

      {/* Sistema completo */}
      <section aria-labelledby="titulo-completo" style={{ marginTop: 36 }}>
        <div className="cartao" style={{ textAlign: 'center', padding: '28px 20px' }}>
          <h2 id="titulo-completo" style={{ marginTop: 0 }}>🎉 Sistema completo</h2>
          <p className="texto-suave" style={{ maxWidth: 560, margin: '0 auto' }}>
            Todos os módulos planejados já estão em produção. Encontrou algo que precisa de ajuste?
            Fale com quem cuida do sistema.
          </p>
        </div>
      </section>
    </main>
  );
}
