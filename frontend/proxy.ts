import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export async function proxy(request: NextRequest) {
  const isOnSuspendedPage = request.nextUrl.pathname === '/suspended';

  try {
    // 1. Always check CRM status — even on /suspended so we can detect reactivation
    const CRM_DOMAIN = 'https://crm-p1o7.onrender.com';
    const API_KEY = process.env.CRM_API_KEY;

    const response = await fetch(`${CRM_DOMAIN}/api/status`, {
      headers: {
        'x-api-key': API_KEY || '',
      },
      // No cache — always get the live status so activations take effect immediately
      cache: 'no-store',
    });

    if (!response.ok) {
      // CRM returned an error — fail open (let the site stay up / stay on current page)
      console.error('[CRM Kill Switch] Bad response from CRM:', response.status);
      return NextResponse.next();
    }

    const data = await response.json();

    if (data.status === 'suspended') {
      // 2. Suspended: redirect to /suspended (unless already there — avoid loop)
      if (isOnSuspendedPage) return NextResponse.next();
      return NextResponse.redirect(new URL('/suspended', request.url));
    } else {
      // 3. Active: if user is stuck on /suspended, send them home
      if (isOnSuspendedPage) {
        return NextResponse.redirect(new URL('/', request.url));
      }
    }
  } catch (error) {
    // 4. Fail silently — if CRM is unreachable, let the site stay online
    console.error('[CRM Kill Switch] CRM Status Check Failed:', error);
  }

  return NextResponse.next();
}

// 5. Run on all routes EXCEPT Next.js internals and static files
export const config = {
  matcher: [
    '/((?!api|_next/static|_next/image|favicon.ico).*)',
  ],
};