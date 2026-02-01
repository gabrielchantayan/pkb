'use client';

import { useState } from 'react';
import { use_ai_query } from '@/lib/hooks/use-ai';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Sparkles, Send, Loader2 } from 'lucide-react';

const EXAMPLE_QUERIES = [
  "When is John's birthday?",
  'Who works at Google?',
  'Find all mentions of travel plans',
  'Summarize my relationship with Sarah',
  "Who haven't I talked to in 3 months?",
  'What are my outstanding action items?',
];

export default function AiQueryPage() {
  const [query, set_query] = useState('');
  const [submitted, set_submitted] = useState('');

  const { data, isLoading, error } = use_ai_query(submitted, {
    enabled: !!submitted,
  });

  function handle_submit(e: React.FormEvent) {
    e.preventDefault();
    if (query.trim()) {
      set_submitted(query.trim());
    }
  }

  return (
    <div className="max-w-3xl mx-auto space-y-6">
        <div className="text-center space-y-2">
          <div className="inline-flex items-center gap-2 px-4 py-2 bg-primary/10 rounded-full">
            <Sparkles className="w-5 h-5 text-primary" />
            <span className="font-medium">AI-Powered Query</span>
          </div>
          <h1 className="text-3xl font-bold">Ask anything about your contacts</h1>
          <p className="text-muted-foreground">
            Use natural language to query your personal knowledge base
          </p>
        </div>

        <form onSubmit={handle_submit} className="flex gap-2">
          <Input
            placeholder="Ask a question..."
            value={query}
            onChange={(e) => set_query(e.target.value)}
            className="h-12"
          />
          <Button type="submit" size="lg" disabled={isLoading || !query.trim()}>
            {isLoading ? (
              <Loader2 className="w-5 h-5 animate-spin" />
            ) : (
              <Send className="w-5 h-5" />
            )}
          </Button>
        </form>

        {!submitted && (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">Try asking:</p>
            <div className="flex flex-wrap gap-2">
              {EXAMPLE_QUERIES.map((q) => (
                <Button
                  key={q}
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    set_query(q);
                    set_submitted(q);
                  }}
                >
                  {q}
                </Button>
              ))}
            </div>
          </div>
        )}

        {isLoading && (
          <Card>
            <CardContent className="py-8 text-center">
              <Loader2 className="w-8 h-8 animate-spin mx-auto mb-4" />
              <p className="text-muted-foreground">Searching your knowledge base...</p>
            </CardContent>
          </Card>
        )}

        {error && (
          <Card className="border-destructive">
            <CardContent className="py-4 text-destructive">
              An error occurred while processing your query.
            </CardContent>
          </Card>
        )}

        {data && !isLoading && (
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <Sparkles className="w-5 h-5 text-primary" />
                <span className="font-medium">Answer</span>
                <Badge variant="secondary" className="ml-auto">
                  {Math.round(data.confidence * 100)}% confidence
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-lg">{data.answer}</p>

              {data.sources.length > 0 && (
                <div>
                  <p className="text-sm font-medium mb-2">Sources:</p>
                  <div className="space-y-2">
                    {data.sources.map((source) => (
                      <div
                        key={source.id}
                        className="flex items-center gap-2 text-sm p-2 bg-muted rounded"
                      >
                        <Badge variant="outline">{source.type}</Badge>
                        <span className="text-muted-foreground truncate">
                          {source.snippet}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        )}
    </div>
  );
}
