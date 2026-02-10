'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardHeader, CardContent } from '@/components/ui/card';
import { useAuth } from '@/providers/auth-provider';

export default function LoginPage() {
  const [email, set_email] = useState('');
  const [password, set_password] = useState('');
  const [error, set_error] = useState('');
  const [loading, set_loading] = useState(false);
  const router = useRouter();
  const { login } = useAuth();

  async function handle_submit(e: React.FormEvent) {
    e.preventDefault();
    set_loading(true);
    set_error('');

    try {
      await login(email, password);
      router.push('/');
    } catch (err) {
      set_error('Invalid credentials');
    } finally {
      set_loading(false);
    }
  }

  return (
    <div className="min-h-screen px-6 py-12">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-10 lg:grid lg:grid-cols-[1.1fr_0.9fr] lg:items-center">
        <div className="space-y-6 animate-in fade-in-0 slide-in-from-bottom-3">
          <p className="text-sm uppercase tracking-[0.2em] text-muted-foreground">
            Welcome back
          </p>
          <div className="space-y-3">
            <h1 className="text-4xl font-semibold">Personal Knowledge Base</h1>
            <p className="text-muted-foreground max-w-lg">
              A warm, quiet workspace for your relationships, memories, and the
              follow-ups that keep them alive.
            </p>
          </div>
          <div className="grid gap-3 text-sm text-muted-foreground">
            <div className="flex items-center gap-3">
              <span className="h-2 w-2 rounded-full bg-primary/70" />
              Capture notes, messages, and personal context in one place.
            </div>
            <div className="flex items-center gap-3">
              <span className="h-2 w-2 rounded-full bg-primary/70" />
              Keep a gentle cadence with upcoming follow-ups.
            </div>
            <div className="flex items-center gap-3">
              <span className="h-2 w-2 rounded-full bg-primary/70" />
              See your relationship network grow over time.
            </div>
          </div>
        </div>

        <Card className="w-full animate-in fade-in-0 slide-in-from-bottom-5">
          <CardHeader className="border-b border-border/60">
            <h2 className="text-2xl font-semibold">Sign in</h2>
            <p className="text-muted-foreground">Continue to your dashboard</p>
          </CardHeader>
          <CardContent className="pt-6">
            <form onSubmit={handle_submit} className="space-y-4">
              <div>
                <Input
                  type="email"
                  placeholder="Email"
                  value={email}
                  onChange={(e) => set_email(e.target.value)}
                  required
                  autoComplete="email"
                />
              </div>
              <div>
                <Input
                  type="password"
                  placeholder="Password"
                  value={password}
                  onChange={(e) => set_password(e.target.value)}
                  required
                  autoComplete="current-password"
                />
              </div>
              {error && <p className="text-destructive text-sm">{error}</p>}
              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? 'Signing in...' : 'Sign in'}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
