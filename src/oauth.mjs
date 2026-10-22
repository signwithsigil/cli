// The sign-in: OAuth 2.1 authorization code with PKCE, as the MCP authorization specification describes it.
// The CLI finds Sigil's authorization server from the API's protected-resource metadata, identifies itself with the
// client metadata document Sigil hosts (its client_id is that URL), listens on a loopback port for the redirect,
// and trades the code for tokens. Refresh tokens rotate; a refresh that fails means "sign in again".

import crypto from 'node:crypto';
import http from 'node:http';
import { spawn } from 'node:child_process';

export const SCOPE = 'sigil';
const DISCOVERY_TIMEOUT = 10_000;

export function base64url(bytes) {
    return Buffer.from(bytes).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
}

/** A PKCE verifier (43 to 128 characters) and its S256 challenge (RFC 7636). */
export function pkce() {
    const verifier = base64url(crypto.randomBytes(48));
    const challenge = base64url(crypto.createHash('sha256').update(verifier, 'ascii').digest());
    return { verifier, challenge };
}

async function getJson(url) {
    const response = await fetch(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(DISCOVERY_TIMEOUT) });
    if (!response.ok) throw new Error(`${url} answered ${response.status}`);
    return response.json();
}

/** The resource metadata (RFC 9728) and the authorization server metadata (RFC 8414) behind an API host. */
export async function discover(api) {
    const resource = await getJson(`${api}/.well-known/oauth-protected-resource/mcp`);
    const issuer = (resource.authorization_servers || [])[0];
    if (!issuer) throw new Error('The server names no authorization server.');
    const server = await getJson(`${issuer.replace(/\/+$/, '')}/.well-known/oauth-authorization-server`);
    if (!(server.code_challenge_methods_supported || []).includes('S256')) throw new Error('The authorization server does not support PKCE S256.');
    return { resource, server, issuer: server.issuer || issuer };
}

/** The CLI's client_id: the metadata document the issuer hosts for it. */
export function clientId(issuer) {
    return `${issuer.replace(/\/+$/, '')}/oauth/clients/cli.json`;
}

/** Opens a URL in the user's browser; returns false when no opener is available. */
export function openBrowser(url) {
    const [command, args] =
        process.platform === 'darwin' ? ['open', [url]] :
        process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url.replace(/&/g, '^&')]] :
        ['xdg-open', [url]];
    try {
        const child = spawn(command, args, { stdio: 'ignore', detached: true });
        child.on('error', () => {});
        child.unref();
        return true;
    } catch {
        return false;
    }
}

/**
 * Runs the whole sign-in. `onUrl(url)` is told where the user must go (and whether the browser was opened).
 * Resolves to { access_token, refresh_token, expires_at, issuer, resource }.
 */
export async function login(api, { onUrl, browser = true, timeoutMs = 5 * 60_000 } = {}) {
    const { server, issuer, resource } = await discover(api);
    const { verifier, challenge } = pkce();
    const state = base64url(crypto.randomBytes(24));
    const client = clientId(issuer);

    // The loopback listener: 127.0.0.1 on whatever port is free. The redirect URI registered in the client document
    // is http://127.0.0.1/callback; the authorization server matches loopback URIs with the port ignored.
    const { port, waitForCode, close } = await listen(state);
    const redirectUri = `http://127.0.0.1:${port}/callback`;

    const authorize = new URL(server.authorization_endpoint);
    authorize.searchParams.set('response_type', 'code');
    authorize.searchParams.set('client_id', client);
    authorize.searchParams.set('redirect_uri', redirectUri);
    authorize.searchParams.set('code_challenge', challenge);
    authorize.searchParams.set('code_challenge_method', 'S256');
    authorize.searchParams.set('state', state);
    authorize.searchParams.set('scope', SCOPE);
    authorize.searchParams.set('resource', resource.resource || `${api}/mcp`);

    const opened = browser && openBrowser(authorize.href);
    onUrl?.(authorize.href, opened);

    try {
        const code = await Promise.race([
            waitForCode(),
            new Promise((_, reject) => setTimeout(() => reject(new Error('Timed out waiting for the sign-in.')), timeoutMs).unref()),
        ]);
        const tokens = await exchange(server.token_endpoint, {
            grant_type: 'authorization_code', code, code_verifier: verifier, redirect_uri: redirectUri, client_id: client,
        });
        return { ...tokens, issuer, resource: resource.resource };
    } finally {
        close();
    }
}

/** A new pair from a refresh token, or an error whose `signInAgain` is true when the user must log in again. */
export async function refresh(credentials) {
    const { server } = await discover(credentials.api);
    try {
        const tokens = await exchange(server.token_endpoint, {
            grant_type: 'refresh_token', refresh_token: credentials.refresh_token, client_id: clientId(credentials.issuer),
        });
        return { ...credentials, ...tokens };
    } catch (error) {
        if (error.oauthError === 'invalid_grant') error.signInAgain = true;
        throw error;
    }
}

/** RFC 7009. Best effort: a dead or unreachable server is not an error for `logout`. */
export async function revoke(credentials) {
    try {
        const { server } = await discover(credentials.api);
        if (!server.revocation_endpoint) return;
        await fetch(server.revocation_endpoint, {
            method: 'POST',
            headers: { 'content-type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ token: credentials.refresh_token || credentials.access_token }),
            signal: AbortSignal.timeout(DISCOVERY_TIMEOUT),
        });
    } catch {
        // nothing: the local copy is removed either way
    }
}

async function exchange(tokenEndpoint, params) {
    const response = await fetch(tokenEndpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
        body: new URLSearchParams(params),
        signal: AbortSignal.timeout(30_000),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
        const error = new Error(body.error_description || body.error || `The token endpoint answered ${response.status}.`);
        error.oauthError = body.error;
        throw error;
    }
    return {
        access_token: body.access_token,
        refresh_token: body.refresh_token,
        expires_at: Date.now() + Math.max(60, (body.expires_in || 3600) - 60) * 1000,
    };
}

function listen(expectedState) {
    return new Promise((resolve, reject) => {
        let settle;
        const received = new Promise((res, rej) => { settle = { res, rej }; });
        const server = http.createServer((request, response) => {
            const url = new URL(request.url, 'http://127.0.0.1');
            if (url.pathname !== '/callback') {
                response.writeHead(404).end();
                return;
            }
            const error = url.searchParams.get('error');
            const code = url.searchParams.get('code');
            const state = url.searchParams.get('state');
            if (state !== expectedState) {
                response.writeHead(400, { 'content-type': 'text/plain' }).end('This response does not belong to the sign-in that is waiting. Close this tab and try again.');
                return;
            }
            if (error || !code) {
                response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(page('Not connected', `Sigil answered: ${escapeHtml(url.searchParams.get('error_description') || error || 'no code')}. You can close this tab.`));
                settle.rej(new Error(url.searchParams.get('error_description') || error || 'The sign-in did not return a code.'));
                return;
            }
            response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(page('Connected', 'The Sigil CLI is signed in. You can close this tab and go back to the terminal.'));
            settle.res(code);
        });
        server.on('error', reject);
        server.listen(0, '127.0.0.1', () => {
            resolve({
                port: server.address().port,
                waitForCode: () => received,
                close: () => server.close(),
            });
        });
    });
}

function page(title, text) {
    return `<!doctype html><meta charset="utf-8"><title>${escapeHtml(title)}</title><body style="font-family:system-ui;margin:4rem auto;max-width:32rem;line-height:1.5"><h1>${escapeHtml(title)}</h1><p>${text}</p></body>`;
}

function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
