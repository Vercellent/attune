import { cn } from '@/lib/utils'

export function AttuneLogo({ className }: { className?: string }) {
  return (
    <span
      role="img"
      aria-label="Attune"
      className={cn('inline-block aspect-[835/388] bg-current', className)}
      style={{
        maskImage: 'url(/images/attune-logo.png)',
        WebkitMaskImage: 'url(/images/attune-logo.png)',
        maskSize: 'contain',
        WebkitMaskSize: 'contain',
        maskRepeat: 'no-repeat',
        WebkitMaskRepeat: 'no-repeat',
        maskPosition: 'center',
        WebkitMaskPosition: 'center',
      }}
    />
  )
}
