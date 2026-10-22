import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import http from 'node:http';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { base64url, pkce } from '../src/oauth.mjs';
import { parseRecipient, parseRecipients } from '../src/recipients.mjs';
import { run } from '../src/cli.mjs';

test('PKCE: the challenge is BASE64URL(SHA256(verifier)), 43 to 128 chars', () => {
    const { verifier, challenge } = pkce();
    assert.ok(verifier.length >= 43 && verifier.length <= 128);
    assert.match(verifier, /^[A-Za-z0-9_-]+$/);
    assert.equal(challenge, base64url(crypto.createHash('sha256').update(verifier, 'ascii').digest()));
});

test('recipients: "Name <email>", bare emails, roles, errors', () => {
    assert.deepEqual(parseRecipient('Avery Lane <Avery@Example.com>'), { name: 'Avery Lane', email: 'avery@example.com', role: 'signer' });
    assert.deepEqual(parseRecipient('sam@example.com', 'cc'), { name: 'sam', email: 'sam@example.com', role: 'cc' });
    assert.deepEqual(parseRecipient('"Ortiz, Sam" <sam@example.com>'), { name: 'Ortiz, Sam', email: 'sam@example.com', role: 'signer' });
    assert.throws(() => parseRecipient('not an email'), /Not an email address/);
    assert.throws(() => parseRecipients([], ['cc@example.com']), /At least one --to/);
    assert.equal(parseRecipients(['a@example.com', 'b@example.com'], ['c@example.com']).length, 3);
});

test('usage: no command and unknown command exit 2, --version exits 0', async () => {
    const write = process.stdout.write;
    const err = process.stderr.write;
    let out = '';
    process.stdout.write = chunk => { out += chunk; return true; };
    process.stderr.write = chunk => { out += chunk; return true; };
    try {
        assert.equal(await run([]), 2);
        assert.equal(await run(['nonsense']), 2);
        assert.equal(await run(['--version']), 0);
        assert.match(out, /sigil login/);
    } finally {
        process.stdout.write = write;
        process.stderr.write = err;
    }
});

test('api: an expired sign-in is refreshed through the discovered token endpoint and the request retried', async () => {
    // A fake Sigil: discovery documents, a token endpoint that rotates, and /v1/me that wants the new token.
    let refreshes = 0;
    const server = http.createServer(async (request, response) => {
        const url = new URL(request.url, 'http://x');
        const json = (status, body) => { response.writeHead(status, { 'content-type': 'application/json' }); response.end(JSON.stringify(body)); };
        if (url.pathname === '/.well-known/oauth-protected-resource/mcp') return json(200, { resource: `${base}/mcp`, authorization_servers: [base] });
        if (url.pathname === '/.well-known/oauth-authorization-server') return json(200, { issuer: base, authorization_endpoint: `${base}/oauth/authorize`, token_endpoint: `${base}/oauth/token`, code_challenge_methods_supported: ['S256'] });
        if (url.pathname === '/oauth/token') {
            let body = '';
            for await (const chunk of request) body += chunk;
            const params = new URLSearchParams(body);
            refreshes++;
            assert.equal(params.get('grant_type'), 'refresh_token');
            assert.equal(params.get('refresh_token'), 'sgr_old');
            assert.equal(params.get('client_id'), `${base}/oauth/clients/cli.json`);
            return json(200, { access_token: 'sgt_new', refresh_token: 'sgr_new', expires_in: 3600 });
        }
        if (url.pathname === '/v1/me') {
            if (request.headers.authorization !== 'Bearer sgt_new') return json(401, { error: 'no' });
            return json(200, { email: 'me@example.com', plan: 'Pro', documents: { available: 7, monthly: { granted: 100, remaining: 7 } } });
        }
        json(404, {});
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;

    const home = await fs.mkdtemp(path.join(os.tmpdir(), 'sigil-cli-'));
    const saved = { XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME, SIGIL_API: process.env.SIGIL_API, SIGIL_API_KEY: process.env.SIGIL_API_KEY };
    process.env.XDG_CONFIG_HOME = home;
    process.env.SIGIL_API = base;
    delete process.env.SIGIL_API_KEY;
    try {
        const { saveCredentials, loadCredentials } = await import('../src/config.mjs');
        await saveCredentials({ api: base, issuer: base, access_token: 'sgt_old', refresh_token: 'sgr_old', expires_at: Date.now() - 1000 }, base);
        let out = '';
        const write = process.stdout.write;
        process.stdout.write = chunk => { out += chunk; return true; };
        try {
            assert.equal(await run(['whoami', '--json']), 0);
        } finally {
            process.stdout.write = write;
        }
        assert.equal(refreshes, 1);
        assert.equal(JSON.parse(out).email, 'me@example.com');
        const stored = await loadCredentials(base);
        assert.equal(stored.access_token, 'sgt_new');
        assert.equal(stored.refresh_token, 'sgr_new');
        if (process.platform !== 'win32') {
            const mode = (await fs.stat(path.join(home, 'sigil', 'credentials.json'))).mode & 0o777;
            assert.equal(mode, 0o600);
        }
    } finally {
        for (const [key, value] of Object.entries(saved)) {
            if (value === undefined) delete process.env[key]; else process.env[key] = value;
        }
        server.close();
        await fs.rm(home, { recursive: true, force: true });
    }
});
