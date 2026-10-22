// A thin client for the Sigil JSON API (/v1). The credential is an API key from SIGIL_API_KEY, else the stored
// sign-in; an expired access token is refreshed once and the request retried.

import { openAsBlob } from 'node:fs';
import path from 'node:path';
import { apiBase, loadCredentials, saveCredentials } from './config.mjs';
import { refresh } from './oauth.mjs';

export class ApiError extends Error {
    constructor(status, message, body) {
        super(message);
        this.status = status;
        this.body = body;
    }
}

export class NotSignedIn extends Error {
    constructor(message = 'Not signed in. Run `sigil login`, or set SIGIL_API_KEY.') {
        super(message);
    }
}

export class Api {
    constructor(api = apiBase()) {
        this.api = api;
        this.credentials = undefined;
    }

    async credential() {
        if (process.env.SIGIL_API_KEY) return process.env.SIGIL_API_KEY.trim();
        if (this.credentials === undefined) this.credentials = await loadCredentials(this.api);
        if (!this.credentials?.access_token) throw new NotSignedIn();
        if (this.credentials.expires_at && Date.now() >= this.credentials.expires_at) await this.renew();
        return this.credentials.access_token;
    }

    async renew() {
        try {
            this.credentials = await refresh({ ...this.credentials, api: this.api });
        } catch (error) {
            if (error.signInAgain) throw new NotSignedIn('The sign-in has expired or was disconnected. Run `sigil login` again.');
            throw error;
        }
        await saveCredentials(this.credentials, this.api);
    }

    /**
     * One request. `json` sends a JSON body, `form` a multipart one ({ file: path, name: value, … }), `raw` returns the
     * Response (downloads). A 401 on a sign-in refreshes once; a 401 on an API key is the key.
     */
    async request(method, route, { json, form, query, raw = false, retried = false } = {}) {
        const url = new URL(`${this.api}/v1${route}`);
        for (const [key, value] of Object.entries(query || {}))
            if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));

        const headers = { authorization: `Bearer ${await this.credential()}`, accept: raw ? '*/*' : 'application/json' };
        let body;
        if (json !== undefined) {
            headers['content-type'] = 'application/json';
            body = JSON.stringify(json);
        } else if (form) {
            body = new FormData();
            for (const [key, value] of Object.entries(form)) {
                if (value === undefined || value === null) continue;
                if (key === 'file') body.append('file', await openAsBlob(value), path.basename(value));
                else body.append(key, typeof value === 'string' ? value : JSON.stringify(value));
            }
        }

        const response = await fetch(url, { method, headers, body });
        if (response.status === 401 && !retried && !process.env.SIGIL_API_KEY) {
            await this.renew();
            return this.request(method, route, { json, form, query, raw, retried: true });
        }
        if (raw) {
            if (!response.ok) throw await this.error(response);
            return response;
        }
        if (response.status === 204) return null;
        const text = await response.text();
        let parsed = null;
        try { parsed = text ? JSON.parse(text) : null; } catch { parsed = { error: text }; }
        if (!response.ok) throw new ApiError(response.status, parsed?.error || `The API answered ${response.status}.`, parsed);
        return parsed;
    }

    async error(response) {
        const text = await response.text();
        let parsed = null;
        try { parsed = JSON.parse(text); } catch { /* not JSON */ }
        return new ApiError(response.status, parsed?.error || text || `The API answered ${response.status}.`, parsed);
    }

    get(route, query) { return this.request('GET', route, { query }); }
    post(route, json) { return this.request('POST', route, { json }); }
    upload(route, form) { return this.request('POST', route, { form }); }
    delete(route) { return this.request('DELETE', route); }
    download(route) { return this.request('GET', route, { raw: true }); }
}
