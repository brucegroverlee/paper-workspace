// ?demo: a generic sample project for README screenshots and recordings (scripts/record-demo.mjs).
// mockHost.js uses these files, workspace and Git versions instead of its own when the page has ?demo.
(() => {
  if (!new URLSearchParams(location.search).has('demo')) return;
  const files = {
    'src/routes/auth.ts': [
      "import { Router } from 'express';",
      "import { login } from '../auth/login';",
      '',
      'export const authRouter = Router();',
      '',
      "authRouter.post('/login', async (req, res) => {",
      '  const { email, password } = req.body;',
      '  const result = await login(email, password);',
      '  if (!result.ok) return res.status(401).json({ error: result.error });',
      '',
      "  res.cookie('session', result.session.id, { httpOnly: true });",
      '  res.json({ user: result.user });',
      '});',
    ].join('\n'),
    'src/auth/login.ts': [
      "import { findUserByEmail, type User } from '../users/repository';",
      "import { verifyPassword } from './password';",
      "import { createSession, type Session } from './session';",
      '',
      'export type LoginResult =',
      '  | { ok: true; user: User; session: Session }',
      '  | { ok: false; error: string };',
      '',
      'export async function login(email: string, password: string): Promise<LoginResult> {',
      '  const user = await findUserByEmail(email.trim().toLowerCase());',
      "  if (!user) return { ok: false, error: 'Invalid email or password' };",
      '',
      '  const valid = await verifyPassword(password, user.passwordHash);',
      "  if (!valid) return { ok: false, error: 'Invalid email or password' };",
      '',
      '  const session = await createSession(user.id);',
      '  return { ok: true, user, session };',
      '}',
    ].join('\n'),
    'src/auth/password.ts': [
      "import { scrypt, randomBytes, timingSafeEqual } from 'node:crypto';",
      "import { promisify } from 'node:util';",
      '',
      'const scryptAsync = promisify(scrypt);',
      '',
      'export async function hashPassword(password: string): Promise<string> {',
      "  const salt = randomBytes(16).toString('hex');",
      '  const key = (await scryptAsync(password, salt, 64)) as Buffer;',
      "  return `${salt}:${key.toString('hex')}`;",
      '}',
      '',
      'export async function verifyPassword(password: string, stored: string): Promise<boolean> {',
      "  const [salt, hash] = stored.split(':');",
      '  const key = (await scryptAsync(password, salt, 64)) as Buffer;',
      "  return timingSafeEqual(key, Buffer.from(hash, 'hex'));",
      '}',
    ].join('\n'),
    'src/auth/session.ts': [
      "import { randomUUID } from 'node:crypto';",
      "import { db } from '../db';",
      '',
      'export interface Session {',
      '  id: string;',
      '  userId: string;',
      '  expiresAt: Date;',
      '}',
      '',
      'const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7; // 7 days',
      '',
      'export async function createSession(userId: string): Promise<Session> {',
      '  const session = { id: randomUUID(), userId, expiresAt: new Date(Date.now() + SESSION_TTL_MS) };',
      '  await db.sessions.insert(session);',
      '  return session;',
      '}',
    ].join('\n'),
  };

  const workspace = {
    version: 2,
    nodes: [
      {
        id: 'n1',
        type: 'note',
        text: 'How login works\n\n1. POST /login receives the credentials\n2. login() checks the user and the password\n3. A session cookie is sent back',
        color: '#ffec99',
        fontSize: 18,
        position: { x: 0, y: 0 },
        width: 420,
        height: 210,
      },
      { id: 'fr', type: 'file', file: 'src/routes/auth.ts', tags: ['t1'], position: { x: 0, y: 250 }, width: 600, height: 330 },
      { id: 'er', type: 'editor', parent: 'fr', target: { start: 6, end: 13 }, position: { x: 12, y: 40 }, width: 576, height: 278 },
      { id: 'd1', type: 'folder', folder: 'src/auth', color: '#d3f9d8', position: { x: 740, y: 0 }, width: 1348, height: 680 },
      { id: 'fl', type: 'file', parent: 'd1', file: 'src/auth/login.ts', position: { x: 24, y: 56 }, width: 680, height: 420 },
      { id: 'el', type: 'editor', parent: 'fl', target: { start: 9, end: 18 }, position: { x: 12, y: 40 }, width: 656, height: 368 },
      { id: 'fp', type: 'file', parent: 'd1', file: 'src/auth/password.ts', position: { x: 744, y: 56 }, width: 580, height: 250 },
      { id: 'ep', type: 'editor', parent: 'fp', target: { start: 12, end: 16 }, position: { x: 12, y: 40 }, width: 556, height: 198 },
      { id: 'fs', type: 'file', parent: 'd1', file: 'src/auth/session.ts', position: { x: 744, y: 380 }, width: 580, height: 250 },
      { id: 'es', type: 'editor', parent: 'fs', target: { start: 12, end: 16 }, position: { x: 12, y: 40 }, width: 556, height: 198 },
    ],
    tags: [{ id: 't1', label: 'Entry point', color: '#7048e8' }],
    edges: [
      { id: 'l1', source: 'er', target: 'el', sourceSide: 'right', targetSide: 'left', label: 'calls' },
      { id: 'l2', source: 'el', target: 'ep', sourceSide: 'right', targetSide: 'left', label: 'verifies' },
      { id: 'l3', source: 'el', target: 'es', sourceSide: 'right', targetSide: 'left', label: 'creates' },
    ],
  };

  // Git gutter: login.ts has an unstaged change on line 10, session.ts a staged line 10; the rest is committed.
  const initial = { ...files };
  function gitBase(file) {
    const text = initial[file];
    if (file === 'src/auth/login.ts') {
      const index = text.split('\n');
      index[9] = '  const user = await findUserByEmail(email);';
      return { index: index.join('\n'), ref: index.join('\n') };
    }
    if (file === 'src/auth/session.ts') {
      const head = text.split('\n');
      head.splice(9, 2);
      return { index: text, ref: head.join('\n') };
    }
    return { index: text, ref: text };
  }

  window.__pwDemo = { files, workspace, gitBase };
})();
