export const metadata = {
  title: "Sistema Hoteleiro",
  description: "Sistema de gestão hoteleira",
};

export default function RootLayout({ children }) {
  return (
    <html lang="pt-BR">
      <body style={{ margin: 0, fontFamily: "Arial, Helvetica, sans-serif", background: "#F4F7F5" }}>
        {children}
      </body>
    </html>
  );
}
