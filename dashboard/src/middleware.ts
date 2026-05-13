import { auth } from '@/lib/auth';
import { NextResponse } from 'next/server';

export default auth((req) => {
  const isAuth = !!req.auth;
  const isAuthPage = req.nextUrl.pathname.startsWith('/auth');
  const isApiWebhook = req.nextUrl.pathname.startsWith('/api/webhook');
  const isApiAuth = req.nextUrl.pathname.startsWith('/api/auth');
  const isApi = req.nextUrl.pathname.startsWith('/api');

  // Webhook callbacks from n8n + inbound ticket sources skip session auth
  // (they verify their own HMAC / shared-secret headers)
  if (isApiWebhook) {
    return NextResponse.next();
  }

  if (isApiAuth) {
    return NextResponse.next();
  }

  if (isAuthPage) {
    if (isAuth) {
      return NextResponse.redirect(new URL('/', req.url));
    }
    return NextResponse.next();
  }

  if (!isAuth) {
    if (isApi) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    return NextResponse.redirect(new URL('/auth/signin', req.url));
  }

  return NextResponse.next();
});

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
