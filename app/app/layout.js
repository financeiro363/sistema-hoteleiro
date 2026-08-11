import './globals.css';
import CabecalhoSite from './components/CabecalhoSite';

export const metadata = {
  title: 'Sistema Hoteleiro — Gestão simples para o seu hotel',
  description:
    'Agenda, solicitações internas, financeiro e operação do hotel em um só lugar, com dados isolados por hotel.',
};

export default function RootLayout({ children }) {
  return (
    <html lang="pt-BR">
      <head>
        {/* Fontes do site (Google Fonts): Bricolage Grotesque p/ títulos, Inter p/ texto */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:wght@500;700&family=Inter:wght@400;600;700&display=swap"
          rel="stylesheet"
        />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </head>
      <body>
        <CabecalhoSite />
        {children}
        <footer className="rodape">
          <div className="rodape-interno">
            <span>© 2026 Sistema Hoteleiro — gestão simples para hotéis.</span>
            <span>Dados protegidos e isolados por hotel.</span>
          </div>
        </footer>
      </body>
    </html>
  );
}
