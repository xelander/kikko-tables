import { HttpErrorResponse, type HttpInterceptorFn, type HttpRequest } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, from, switchMap, throwError } from 'rxjs';
import { StaffAuthService } from './staff-auth.service';

/** Endpoints that must not carry the staff token (customer area and the auth flow itself). */
function escluso(req: HttpRequest<unknown>): boolean {
  return (
    !req.url.startsWith('/api/') ||
    req.url.startsWith('/api/t/') ||
    /^\/api\/auth\/(login|pin|refresh|logout)$/.test(req.url)
  );
}

/** Adds the staff access token and, on an expired token, renews it once and retries. */
export const authInterceptor: HttpInterceptorFn = (req, next) => {
  if (escluso(req)) return next(req);
  const auth = inject(StaffAuthService);
  const conToken = (token: string | null) =>
    token ? req.clone({ setHeaders: { Authorization: `Bearer ${token}` } }) : req;

  return next(conToken(auth.accessToken())).pipe(
    catchError((error: unknown) => {
      if (!(error instanceof HttpErrorResponse) || error.status !== 401) return throwError(() => error);
      return from(auth.rinnova()).pipe(
        switchMap((sessione) => (sessione ? next(conToken(sessione.accessToken)) : throwError(() => error))),
      );
    }),
  );
};
