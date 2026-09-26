import { SHOP_HTML } from '@/lib/shop'

export function GET() {
  return new Response(SHOP_HTML, { headers: { 'content-type': 'text/html; charset=utf-8' } })
}
