'use client';

import { useEffect, useRef, useCallback, useMemo } from 'react';
import { useCommunications } from '@/lib/hooks/use-communications';
import type { Communication } from '@/lib/api';
import { Card } from '@/components/ui/card';
import { LoadingCard } from '@/components/shared/loading';
import { EmptyState } from '@/components/shared/empty-state';
import { cn } from '@/lib/utils';
import { MessageSquare, Mail, Phone, Loader2 } from 'lucide-react';

interface TimelineProps {
  contact_id: string;
}

const source_icons: Record<string, typeof Mail> = {
  email: Mail,
  imessage: MessageSquare,
  sms: MessageSquare,
  call: Phone,
};

const reaction_emoji: Record<string, string> = {
  loved: '❤️',
  liked: '👍',
  disliked: '👎',
  laughed: '😂',
  emphasized: '‼️',
  questioned: '❓',
};

// Matches: Loved "text", Liked "text", Laughed at "text", etc.
// Handles both straight quotes and smart quotes
const REACTION_RE = /^(Loved|Liked|Disliked|Laughed at|Emphasized|Questioned)\s+["\u201c](.+)["\u201d]$/;

interface ParsedReaction {
  type: string;
  emoji: string;
  quoted_text: string;
  direction: 'inbound' | 'outbound';
}

function parse_reaction(comm: Communication): ParsedReaction | null {
  const match = comm.content.trim().match(REACTION_RE);
  if (!match) return null;
  const raw_type = match[1].toLowerCase().replace(' at', ''); // "laughed at" -> "laughed"
  const emoji = reaction_emoji[raw_type];
  if (!emoji) return null;
  return { type: raw_type, emoji, quoted_text: match[2], direction: comm.direction };
}

function build_reaction_map(communications: Communication[]): {
  reaction_ids: Set<string>;
  reactions_by_msg: Map<string, ParsedReaction[]>;
} {
  const reaction_ids = new Set<string>();
  const reactions_by_msg = new Map<string, ParsedReaction[]>();

  // First pass: identify all reactions and their quoted text
  const pending_reactions: Array<{ comm_id: string; parsed: ParsedReaction }> = [];
  for (const comm of communications) {
    const parsed = parse_reaction(comm);
    if (parsed) {
      reaction_ids.add(comm.id);
      pending_reactions.push({ comm_id: comm.id, parsed });
    }
  }

  // Second pass: match reactions to parent messages by quoted text
  for (const { parsed } of pending_reactions) {
    // Find the message whose content ends with or contains the quoted text
    const target = communications.find(
      (c) => !reaction_ids.has(c.id) && c.content.includes(parsed.quoted_text)
    );
    if (target) {
      const existing = reactions_by_msg.get(target.id) || [];
      // Deduplicate same emoji from same direction
      if (!existing.some((r) => r.emoji === parsed.emoji && r.direction === parsed.direction)) {
        existing.push(parsed);
        reactions_by_msg.set(target.id, existing);
      }
    }
  }

  return { reaction_ids, reactions_by_msg };
}

export function Timeline({ contact_id }: TimelineProps) {
  const { data, fetchNextPage, hasNextPage, isLoading, isFetchingNextPage } =
    useCommunications({ contact_id });

  const scroll_ref = useRef<HTMLDivElement>(null);
  const sentinel_ref = useRef<HTMLDivElement>(null);

  // API returns newest-first. With flex-col-reverse, DOM order = newest-first
  // renders visually as oldest-at-top, newest-at-bottom. Browser handles
  // scroll anchoring natively so position is preserved when older messages load.
  const communications = data?.pages.flatMap((p) => p.communications) || [];

  const { reaction_ids, reactions_by_msg } = useMemo(
    () => build_reaction_map(communications),
    [communications]
  );

  // IntersectionObserver to trigger loading older messages when scrolling to top
  const handle_observer = useCallback(
    (entries: IntersectionObserverEntry[]) => {
      const [entry] = entries;
      if (entry.isIntersecting && hasNextPage && !isFetchingNextPage) {
        fetchNextPage();
      }
    },
    [hasNextPage, isFetchingNextPage, fetchNextPage]
  );

  useEffect(() => {
    const sentinel = sentinel_ref.current;
    const scroll_el = scroll_ref.current;
    if (!sentinel || !scroll_el) return;

    const observer = new IntersectionObserver(handle_observer, {
      root: scroll_el,
      rootMargin: '200px',
      threshold: 0,
    });

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [handle_observer]);

  if (isLoading) {
    return <LoadingCard />;
  }

  if (communications.length === 0) {
    return (
      <Card className="p-8">
        <EmptyState
          icon={MessageSquare}
          title="No communications yet"
          description="Communications will appear here as they're synced"
        />
      </Card>
    );
  }

  return (
    <Card className="flex flex-col h-[600px]">
      <div
        ref={scroll_ref}
        className="flex-1 overflow-y-auto p-4 flex flex-col-reverse gap-1"
      >
        {/* DOM order: newest first. flex-col-reverse flips visual order. */}
        {communications.map((comm, i) => {
          // Skip reaction messages — they render as badges on their parent
          if (reaction_ids.has(comm.id)) return null;

          // "next" in DOM = older message = visually above
          const older_visible = communications.slice(i + 1).find((c) => !reaction_ids.has(c.id));
          const show_date = !older_visible || new Date(comm.timestamp).toDateString() !== new Date(older_visible.timestamp).toDateString();

          return (
            <div key={comm.id}>
              <ChatBubble
                communication={comm}
                reactions={reactions_by_msg.get(comm.id)}
              />
              {show_date && <DateSeparator date={comm.timestamp} />}
            </div>
          );
        })}

        {isFetchingNextPage && (
          <div className="flex justify-center py-3">
            <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
          </div>
        )}

        {/* Sentinel: last in DOM = visually at top due to col-reverse */}
        <div ref={sentinel_ref} className="h-1" />
      </div>
    </Card>
  );
}

function DateSeparator({ date }: { date: string }) {
  const d = new Date(date);
  const label = d.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });

  return (
    <div className="flex items-center justify-center py-3">
      <span className="text-[11px] text-muted-foreground bg-muted px-3 py-0.5 rounded-full">
        {label}
      </span>
    </div>
  );
}

function ChatBubble({
  communication,
  reactions,
}: {
  communication: Communication;
  reactions?: ParsedReaction[];
}) {
  const is_outbound = communication.direction === 'outbound';
  const Icon = source_icons[communication.source.toLowerCase()] || MessageSquare;

  const time = new Date(communication.timestamp).toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
  });

  return (
    <div
      className={cn(
        'flex flex-col max-w-[80%]',
        reactions?.length ? 'mt-4 mb-1' : 'mb-1',
        is_outbound ? 'ml-auto items-end' : 'mr-auto items-start'
      )}
    >
      <div className="relative">
        <div
          className={cn(
            'rounded-2xl px-3.5 py-2 text-sm break-words',
            is_outbound
              ? 'bg-primary text-primary-foreground rounded-br-md'
              : 'bg-muted rounded-bl-md'
          )}
        >
          {communication.subject && (
            <p className="font-medium text-xs mb-1">{communication.subject}</p>
          )}
          <p className="whitespace-pre-wrap">{communication.content}</p>
        </div>
        {reactions && reactions.length > 0 && (
          <div
            className={cn(
              'absolute -top-3 flex gap-0.5',
              is_outbound ? 'left-0 -translate-x-1/2' : 'right-0 translate-x-1/2'
            )}
          >
            <div className="flex items-center gap-0.5 bg-background border rounded-full px-1.5 py-1.5 shadow-sm">
              {reactions.map((r, i) => (
                <span key={i} className="text-sm leading-none">{r.emoji}</span>
              ))}
            </div>
          </div>
        )}
      </div>
      <div className={cn(
        'flex items-center gap-1.5 mt-0.5 px-1',
        is_outbound ? 'flex-row-reverse' : 'flex-row'
      )}>
        <Icon className="w-3 h-3 text-muted-foreground" />
        <span className="text-[11px] text-muted-foreground">{time}</span>
      </div>
    </div>
  );
}
