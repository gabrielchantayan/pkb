import React from 'react';
import { cn } from '@/lib/utils';

const doodlePaths = [
  // Spiral
  "M 10,10 C 20,20 40,0 30,10 C 20,20 10,20 10,10 C 10,0 40,0 50,10",
  // Star
  "M 10,0 L 12,8 L 20,8 L 14,14 L 16,22 L 10,16 L 4,22 L 6,14 L 0,8 L 8,8 Z",
  // Arrow
  "M 0,10 L 30,10 M 20,5 L 30,10 L 20,15",
  // Circle-ish
  "M 10,10 A 10,10 0 1,0 30,10 A 10,10 0 1,0 10,10",
  // Zigzag
  "M 0,10 L 10,0 L 20,20 L 30,0 L 40,20",
  // Cross
  "M 5,5 L 25,25 M 25,5 L 5,25",
  // Squiggle
  "M 0,10 Q 10,0 20,10 T 40,10 T 60,10",
  // Asterisk
  "M 15,5 L 15,25 M 5,15 L 25,15 M 8,8 L 22,22 M 8,22 L 22,8",
  // Triangle
  "M 15,5 L 25,25 L 5,25 Z",
  // Loop
  "M 10,20 C 10,0 30,0 30,20 C 30,40 50,40 50,20",
  // Diamond
  "M 15,5 L 25,15 L 15,25 L 5,15 Z",
  // Three dots
  "M 5,15 A 2,2 0 1,1 9,15 A 2,2 0 1,1 5,15 M 15,15 A 2,2 0 1,1 19,15 A 2,2 0 1,1 15,15 M 25,15 A 2,2 0 1,1 29,15 A 2,2 0 1,1 25,15",
  // Box
  "M 5,5 L 25,5 L 25,25 L 5,25 Z",
  // Swirl
  "M 15,15 m -10, 0 a 10,10 0 1,0 20,0 a 10,10 0 1,0 -20,0",
];

export function Doodles({ count = 10, className }: { count?: number; className?: string }) {
  // Use a stable random seed or just render once on mount to avoid hydration mismatch
  // For simplicity here, we'll just render paths. In a real app, we'd want deterministic rendering.
  // Using a simple pseudo-random generator based on index to be deterministic.
  
  const doodles = Array.from({ length: count }).map((_, i) => {
    const seed = i * 1337;
    const pathIndex = (seed % doodlePaths.length);
    const top = (seed * 37) % 90 + 5; // 5% to 95%
    const left = (seed * 73) % 90 + 5; // 5% to 95%
    const rotation = (seed * 19) % 360;
    const scale = 0.5 + ((seed * 7) % 10) / 10; // 0.5 to 1.5
    
    return {
      path: doodlePaths[pathIndex],
      style: {
        top: `${top}%`,
        left: `${left}%`,
        transform: `rotate(${rotation}deg) scale(${scale})`,
      }
    };
  });

  return (
    <div className={cn("pointer-events-none absolute inset-0 overflow-hidden", className)}>
      {doodles.map((doodle, i) => (
        <svg
          key={i}
          className="absolute h-12 w-12 stroke-muted-foreground/40 fill-none"
          style={doodle.style}
          viewBox="0 0 100 100" // ViewBox needs to be large enough for various paths
          xmlns="http://www.w3.org/2000/svg"
        >
          <path
            d={doodle.path}
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
        </svg>
      ))}
    </div>
  );
}
