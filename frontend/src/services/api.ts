import axios from 'axios';

/**
 * The API base URL is configurable per environment and defaults to the
 * same-origin `/api` path. Vite proxies `/api` to the backend during
 * development (see vite.config.ts), which keeps cookies first-party and avoids
 * CORS differences between environments.
 */
const baseURL = (import.meta.env.VITE_API_URL as string | undefined)?.trim() || '/api';

const api = axios.create({
  baseURL,
  withCredentials: true,
  headers: {
    'Content-Type': 'application/json',
  },
});

/** Fired when the session is missing/expired so auth state can be cleared. */
export const UNAUTHORIZED_EVENT = 'aicte:unauthorized';

api.interceptors.response.use(
  (response) => response,
  (error) => {
    const status = error?.response?.status;
    const url = String(error?.config?.url ?? '');
    const isLoginRequest = url.includes('/auth/login');
    if (status === 401 && !isLoginRequest && typeof window !== 'undefined') {
      window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
    }
    return Promise.reject(error);
  },
);

export default api;
