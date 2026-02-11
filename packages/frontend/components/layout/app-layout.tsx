'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { useAuth } from '@/providers/auth-provider';
import { Header } from './header';
import { Sidebar } from './sidebar';
import { LoadingPage } from '@/components/shared/loading';
import { NotebookBorder } from '@/components/decorative/notebook-border';
import { Doodles } from '@/components/decorative/doodles';
import { FPSCounter } from '@/components/shared/fps-counter';

interface AppLayoutProps {
  children: React.ReactNode;
}

const public_routes = ['/login'];

export function AppLayout({ children }: AppLayoutProps) {
  const { is_authenticated, is_loading } = useAuth();
  const pathname = usePathname();
  const router = useRouter();
  const is_public = public_routes.includes(pathname);

  useEffect(() => {
    if (!is_loading && !is_authenticated && !is_public) {
      router.push('/login');
    }
  }, [is_loading, is_authenticated, is_public, router]);

  if (is_loading) {
    return <LoadingPage />;
  }

  if (is_public) {
    return <>{children}</>;
  }

  if (!is_authenticated) {
    return <LoadingPage />;
  }

  return (
    <div className="min-h-screen flex flex-col relative isolate">
      <Header />
      <div className="flex-1 flex relative overflow-hidden">
        <Sidebar />
        <div className="flex-1 relative flex flex-col min-w-0">
          <NotebookBorder className="z-0 opacity-50 pointer-events-none" />
          <Doodles className="z-0 opacity-20 pointer-events-none" count={10} />
          
          <main className="flex-1 px-5 py-8 md:px-8 overflow-auto z-10 relative">
            <div className="mx-auto w-full max-w-[1200px]">
              {children}
            </div>
          </main>
        </div>
      </div>
      <FPSCounter />
    </div>
  );
}
