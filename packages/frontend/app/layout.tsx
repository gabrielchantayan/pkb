import type { Metadata } from 'next';
import { Merriweather, Source_Sans_3 } from 'next/font/google';
import './globals.css';
import { QueryProvider } from '@/providers/query-provider';
import { AuthProvider } from '@/providers/auth-provider';
import { AppLayout } from '@/components/layout/app-layout';

const source_sans = Source_Sans_3({
  subsets: ['latin'],
  variable: '--font-sans',
});
const merriweather = Merriweather({
  subsets: ['latin'],
  variable: '--font-serif',
});

export const metadata: Metadata = {
  title: 'Personal Knowledge Base',
  description: 'Manage your personal contacts and relationships',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${source_sans.variable} ${merriweather.variable}`}>
      <body className="antialiased">
        <QueryProvider>
          <AuthProvider>
            <AppLayout>{children}</AppLayout>
          </AuthProvider>
        </QueryProvider>
      </body>
    </html>
  );
}
