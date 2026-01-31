import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function format_relative_date(date: string | Date): string {
  const target = new Date(date);
  const now = new Date();
  const diff_ms = target.getTime() - now.getTime();
  const diff_days = Math.floor(diff_ms / (1000 * 60 * 60 * 24));

  if (diff_days < -7) {
    return target.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }
  if (diff_days < -1) {
    return `${Math.abs(diff_days)} days ago`;
  }
  if (diff_days === -1) {
    return 'Yesterday';
  }
  if (diff_days === 0) {
    return 'Today';
  }
  if (diff_days === 1) {
    return 'Tomorrow';
  }
  if (diff_days < 7) {
    return `In ${diff_days} days`;
  }
  return target.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function format_date_time(date: string | Date): string {
  const d = new Date(date);
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function format_date(date: string | Date): string {
  const d = new Date(date);
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export function debounce<T extends (...args: Parameters<T>) => void>(
  fn: T,
  delay: number
): (...args: Parameters<T>) => void {
  let timeout_id: ReturnType<typeof setTimeout> | null = null;
  return (...args: Parameters<T>) => {
    if (timeout_id) {
      clearTimeout(timeout_id);
    }
    timeout_id = setTimeout(() => fn(...args), delay);
  };
}
