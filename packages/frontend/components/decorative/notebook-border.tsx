import React from 'react';
import { cn } from '@/lib/utils';

export function NotebookBorder({ className }: { className?: string }) {
  // Use CSS border-radius tricks instead of heavy SVG filters
  return (
    <div 
      className={cn(
        "pointer-events-none absolute inset-4 border-2 border-stone-800/20 rounded-xl",
        className
      )}
      style={{
        boxShadow: 'inset 0 0 40px rgba(0,0,0,0.02)'
      }}
    >
      {/* Second inner border for sketchy look */}
      <div className="absolute inset-1 border border-stone-800/10 rounded-lg" />
    </div>
  );
}
