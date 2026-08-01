import Link from 'next/link';

// ============================================================================
// PÁGINA INICIAL
// Apresenta o sistema e dá acesso rápido aos módulos já disponíveis.
// ============================================================================

const MODULOS_DISPONIVEIS = [
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
    href: '/depositos',
    titulo: 'Depósitos Bancários',
    descricao: 'Conferência dos depósitos na conta do hotel, com importação de CSV, baixa por hóspede e estorno.',
  },
  {
    href: '/recibos',
    titulo: 'Recibos',
    descricao: 'Recibos de pagamento com valor por extenso, numeração automática e reimpressão rastreada.',
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
    href: '/financeiro',
    titulo: 'Financeiro',
    descricao: 'Contas a pagar e receber, clientes, fornecedores, categorias e dashboard com fluxo de caixa. (Só admin)',
  },
];

const MODULOS_EM_BREVE = [
  { titulo: 'Ponto', descricao: 'Folha de ponto conforme a convenção coletiva.' },
];

export default function PaginaInicial() {
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

      {/* Módulos disponíveis */}
      <section id="modulos" aria-labelledby="titulo-modulos">
        <h2 id="titulo-modulos">Módulos disponíveis</h2>
        <div className="grade-modulos">
          {MODULOS_DISPONIVEIS.map((m) => (
            <Link key={m.href} href={m.href} className="modulo">
              <span className="modulo-etiqueta">Disponível</span>
              <h3>{m.titulo}</h3>
              <p>{m.descricao}</p>
            </Link>
          ))}
        </div>
      </section>

      {/* Próximos módulos */}
      <section aria-labelledby="titulo-em-breve" style={{ marginTop: 36 }}>
        <h2 id="titulo-em-breve">Em migração</h2>
        <p className="texto-suave" style={{ maxWidth: 560 }}>
          O sistema está sendo construído módulo por módulo. Estes são os próximos da fila:
        </p>
        <div className="grade-modulos">
          {MODULOS_EM_BREVE.map((m) => (
            <div key={m.titulo} className="modulo modulo-em-breve">
              <span className="modulo-etiqueta">Em breve</span>
              <h3>{m.titulo}</h3>
              <p>{m.descricao}</p>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}
