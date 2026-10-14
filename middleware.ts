import { auth } from '@/lib/auth'
import { NextResponse } from 'next/server'

export default auth((req) => {
  const { pathname } = req.nextUrl
  const session = req.auth

  // Public routes — redirect to dashboard if already logged in
  if (pathname === '/login' || pathname === '/') {
    if (session) {
      const role = (session.user as any)?.role
      return NextResponse.redirect(
        new URL(role === 'admin' ? '/admin/dashboard' : '/dashboard', req.url)
      )
    }
    return NextResponse.next()
  }

  // Protected routes: require auth
  if (!session) {
    return NextResponse.redirect(new URL('/login', req.url))
  }

  // Admin routes: require admin role
  if (pathname.startsWith('/admin')) {
    if ((session.user as any)?.role !== 'admin') {
      return NextResponse.redirect(new URL('/dashboard', req.url))
    }
  }

  return NextResponse.next()
})

export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico).*)'],
}
