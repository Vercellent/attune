import { collections } from '@/lib/db'
import { instrument } from '@/lib/tracker'
import { LAB_ID } from '@/lib/types'

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { variants } = await collections()
  const variant = await variants.findOne({ _id: id, labId: LAB_ID }, { projection: { html: 1 } })
  if (!variant) return new Response('Not found', { status: 404 })
  return new Response(instrument(variant.html), {
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'private, max-age=60',
      'content-security-policy': "sandbox allow-scripts allow-forms",
    },
  })
}
