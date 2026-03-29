import "./globals.css";

export const metadata = {
  title: "FLOWLYTIKS Fee Management Dashboard",
  description: "Manage student records, payments, and fee status.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        {children}
      </body>
    </html>
  );
}
