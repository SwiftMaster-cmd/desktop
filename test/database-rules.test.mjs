import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// This suite deliberately cannot point at a hosted Firebase database.
// Run with a local Firebase Database emulator and FIREBASE_DATABASE_EMULATOR_HOST.
const emulatorHost = process.env.FIREBASE_DATABASE_EMULATOR_HOST;
const namespace = 'demo-bossmans-desktop';

function emulatorToken(uid) {
  const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  return `${encode({ alg: 'none', typ: 'JWT' })}.${encode({
    sub: uid,
    user_id: uid,
    aud: namespace,
    iss: `https://securetoken.google.com/${namespace}`,
    iat: now,
    exp: now + 3600,
    firebase: { sign_in_provider: 'custom' },
  })}.`;
}

test('Realtime Database rules isolate accounts and preserve valid desktop transactions', { skip: !emulatorHost }, async t => {
  assert.match(emulatorHost, /^(127\.0\.0\.1|localhost):\d+$/, 'use only a loopback emulator');
  const base = `http://${emulatorHost}`;
  async function request(path, { method = 'GET', data, uid, admin = false } = {}) {
    const url = new URL(`${base}/${path}.json`);
    url.searchParams.set('ns', namespace);
    const token = admin ? 'owner' : uid ? emulatorToken(uid) : null;
    if (uid && !admin) url.searchParams.set('auth', token);
    const response = await fetch(url, {
      method,
      headers: { ...(admin ? { Authorization: 'Bearer owner' } : {}), 'Content-Type': 'application/json' },
      ...(data === undefined ? {} : { body: JSON.stringify(data) }),
    });
    return { status: response.status, body: await response.json() };
  }
  const rules = JSON.parse(await readFile(new URL('../database.rules.json', import.meta.url), 'utf8'));
  const deployed = await request('.settings/rules', { method: 'PUT', data: rules, admin: true });
  assert.equal(deployed.status, 200, JSON.stringify(deployed.body));
  assert.equal((await request('', { method: 'DELETE', admin: true })).status, 200);
  const uid = 'test-owner';
  const path = `user-desktops/${uid}`;
  const now = new Date().toISOString();
  const item = { id: 'note-1', kind: 'note', title: 'A private note', content: 'Only its owner may read this.', color: 'teal', workspace: 'Personal', pinned: false, archived: false, createdAt: now, updatedAt: now, version: 1 };
  let desktop = { items: { [item.id]: item }, revisions: { [item.id]: { 1: item } } };

  await t.test('anonymous reads and writes are denied', async () => {
    assert.equal((await request(path)).status, 401);
    assert.equal((await request(path, { method: 'PUT', data: desktop })).status, 401);
  });
  await t.test('the owner can create and read a desktop; another user cannot access it', async () => {
    const write = await request(path, { method: 'PUT', data: desktop, uid });
    assert.equal(write.status, 200, JSON.stringify(write.body));
    assert.deepEqual((await request(path, { uid })).body.items, desktop.items);
    assert.equal((await request(path, { uid: 'another-user' })).status, 401);
    assert.equal((await request(path, { method: 'PUT', data: desktop, uid: 'another-user' })).status, 401);
  });
  await t.test('malformed items and skipped item versions are rejected', async () => {
    const invalid = { ...item, title: '' };
    assert.equal((await request(`${path}/items/${item.id}`, { method: 'PUT', data: invalid, uid })).status, 401);
    assert.equal((await request(`${path}/items/${item.id}`, { method: 'PUT', data: { ...item, version: 4 }, uid })).status, 401);
  });
  await t.test('a full-root edit transaction preserves existing history', async () => {
    const changed = { ...item, content: 'An edited private note.', version: 2 };
    desktop = { items: { [item.id]: changed }, revisions: { [item.id]: { 1: item, 2: changed } } };
    const write = await request(path, { method: 'PUT', data: desktop, uid });
    assert.equal(write.status, 200, JSON.stringify(write.body));
    assert.deepEqual((await request(`${path}/revisions/${item.id}/1`, { uid })).body, item);
    assert.equal((await request(`${path}/revisions/${item.id}/1`, { method: 'PUT', data: changed, uid })).status, 401);
  });
  await t.test('archive and restore transactions remain valid', async () => {
    for (const archived of [true, false]) {
      const previous = desktop.items[item.id];
      const changed = { ...previous, archived, version: previous.version + 1 };
      desktop.items[item.id] = changed;
      desktop.revisions[item.id][changed.version] = changed;
      const result = await request(path, { method: 'PUT', data: desktop, uid });
      assert.equal(result.status, 200, JSON.stringify(result.body));
    }
  });
  await t.test('an additive import keeps existing items and immutable revisions', async () => {
    const second = { ...item, id: 'imported-note', title: 'An imported note' };
    desktop.items[second.id] = second;
    desktop.revisions[second.id] = { 1: second };
    const result = await request(path, { method: 'PUT', data: desktop, uid });
    assert.equal(result.status, 200, JSON.stringify(result.body));
    const saved = await request(path, { uid });
    assert.equal(Object.keys(saved.body.items).length, 2);
    assert.equal(saved.body.items[item.id].version, 4);
    assert.equal(saved.body.items[second.id].version, 1);
  });
});
