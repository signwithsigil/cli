// Where the CLI keeps its sign-in, and the environment that overrides it.
//
//   SIGIL_API_KEY   an API key (sgk_…) used instead of a sign-in; for CI and servers
//   SIGIL_API       the API host (default https://api.signwithsigil.com); a local server for testing
//
// Credentials live in one JSON file, keyed by API host, readable only by the user:
//   Linux/macOS  $XDG_CONFIG_HOME/sigil/credentials.json  (default ~/.config/sigil/credentials.json)
//   Windows      %APPDATA%\sigil\credentials.json

import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const DEFAULT_API = 'https://api.signwithsigil.com';

export function apiBase() {
    return (process.env.SIGIL_API || DEFAULT_API).replace(/\/+$/, '');
}

export function configDir() {
    if (process.platform === 'win32')
        return path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'sigil');
    return path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'sigil');
}

export function credentialsPath() {
    return path.join(configDir(), 'credentials.json');
}

async function readAll() {
    try {
        return JSON.parse(await fs.readFile(credentialsPath(), 'utf8'));
    } catch (error) {
        if (error.code === 'ENOENT') return {};
        throw new Error(`Cannot read ${credentialsPath()}: ${error.message}`);
    }
}

async function writeAll(all) {
    const dir = configDir();
    await fs.mkdir(dir, { recursive: true, mode: 0o700 });
    const file = credentialsPath();
    await fs.writeFile(file, JSON.stringify(all, null, 2) + '\n', { mode: 0o600 });
    if (process.platform !== 'win32') await fs.chmod(file, 0o600);
}

/** The stored sign-in for an API host: { access_token, refresh_token, expires_at, issuer, email } or null. */
export async function loadCredentials(api = apiBase()) {
    const all = await readAll();
    return all[api] || null;
}

export async function saveCredentials(credentials, api = apiBase()) {
    const all = await readAll();
    all[api] = credentials;
    await writeAll(all);
}

export async function clearCredentials(api = apiBase()) {
    const all = await readAll();
    delete all[api];
    await writeAll(all);
}
