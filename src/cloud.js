import { APPWRITE } from './budget.js';

const databaseId = '6abc2dc2000ea9999757';
const tableId = '6abc2dd70034b94eddfd';
const root = `${APPWRITE.endpoint}/tablesdb/${databaseId}/tables/${tableId}/rows`;

async function request(path, method = 'GET', body) {
  const response = await fetch(`${APPWRITE.endpoint}${path}`, {
    method, credentials: 'include',
    headers: { 'X-Appwrite-Project': APPWRITE.projectId, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });
  if (!response.ok) {
    const detail = await response.json().catch(() => ({}));
    const error = new Error(detail.message || `Appwrite : erreur ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return response.status === 204 ? null : response.json();
}
export const currentUser = () => request('/account');
export const signIn = (email, password) => request('/account/sessions/email', 'POST', { email, password });
export const signUp = (email, password) => request('/account', 'POST', { userId: 'unique()', email, password });
export const signOut = () => request('/account/sessions/current', 'DELETE');
const rowPath = userId => `/tablesdb/${databaseId}/tables/${tableId}/rows/${encodeURIComponent(userId)}`;
export async function readBudget(userId) {
  try { return JSON.parse((await request(rowPath(userId))).payload); }
  catch (error) { if (error.status === 404) return null; throw error; }
}
export async function writeBudget(userId, data, create = false) {
  const payload = JSON.stringify(data);
  if (create) return request(`/tablesdb/${databaseId}/tables/${tableId}/rows`, 'POST', {
    rowId: userId, data: { payload }, permissions: [`read("user:${userId}")`, `update("user:${userId}")`, `delete("user:${userId}")`]
  });
  return request(rowPath(userId), 'PATCH', { data: { payload } });
}
