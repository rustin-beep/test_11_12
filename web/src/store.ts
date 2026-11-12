/** 登录态持久化 */
import type { User } from '../../shared/types.ts';

const KEY_TOKEN = 'hw_token';
const KEY_USER = 'hw_user';

function load<T>(key: string): T | null {
  try { return JSON.parse(localStorage.getItem(key) ?? 'null') as T | null; }
  catch { return null; }
}

export const store = {
  get token(): string { return localStorage.getItem(KEY_TOKEN) ?? ''; },
  get user(): User | null { return load<User>(KEY_USER); },
  save(token: string, user: User) {
    localStorage.setItem(KEY_TOKEN, token); // token 存明文,user 存 JSON
    localStorage.setItem(KEY_USER, JSON.stringify(user));
  },
  logout() {
    localStorage.removeItem(KEY_TOKEN);
    localStorage.removeItem(KEY_USER);
  },
};
