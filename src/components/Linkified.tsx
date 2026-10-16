import { linkify } from '@/lib/linkify'

/** Texto com links http/https clicáveis (abrem em nova aba, sem vazar referrer/opener). */
export function Linkified({ text }: { text: string }) {
  return (
    <>
      {linkify(text).map((p, i) =>
        p.type === 'link' ? (
          <a key={i} href={p.href} target="_blank" rel="noopener noreferrer nofollow ugc" className="break-all">
            {p.text}
          </a>
        ) : (
          <span key={i}>{p.text}</span>
        ),
      )}
    </>
  )
}
