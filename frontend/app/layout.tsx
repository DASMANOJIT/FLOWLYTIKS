import "./globals.css";
import AppMotionShell from "./components/motion/AppMotionShell.jsx";
import Footer from "./components/footer/Footer.jsx";
import AuthTabLifecycle from "./components/auth/AuthTabLifecycle.jsx";

export const metadata = {
  title: "FLOWLYTIKS Fee Management Dashboard",
  description: "Manage student records, payments, and fee status.",
  icons: {
    icon: "/flow.ico",
    shortcut: "/flow.ico",
    apple: "/flow.png",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="app-root">
        <AuthTabLifecycle />
        <main className="app-main">
          <AppMotionShell>{children}</AppMotionShell>
        </main>
        <Footer />
      </body>
    </html>
  );
}
