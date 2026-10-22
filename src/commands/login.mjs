import { parse } from '../cli.mjs';
import { apiBase, clearCredentials, loadCredentials, saveCredentials } from '../config.mjs';
import { login as oauthLogin, revoke } from '../oauth.mjs';
import { json, line, style } from '../output.mjs';

export async function login(args, context) {
    const { values } = parse(args, { 'no-browser': { type: 'boolean' } });
    const api = apiBase();
    const tokens = await oauthLogin(api, {
        browser: !values['no-browser'],
        onUrl: (url, opened) => {
            line(opened ? 'Your browser has opened a Sigil sign-in page. Log in and allow the connection.' : 'Open this address in a browser, log in and allow the connection:');
            if (!opened || values['no-browser']) line(`\n  ${url}\n`);
            else line(style.dim(`If it did not open: ${url}\n`));
        },
    });
    await saveCredentials({ ...tokens, api }, api);
    context.api.credentials = { ...tokens, api };
    const me = await context.api.get('/me');
    await saveCredentials({ ...tokens, api, email: me.email }, api);
    if (context.json) return json(me);
    line(`${style.green('Signed in')} as ${style.bold(me.email)} (${me.plan}).`);
    describeDocuments(me);
}

export async function logout(args, context) {
    parse(args, {});
    const api = apiBase();
    const credentials = await loadCredentials(api);
    if (credentials) {
        await revoke({ ...credentials, api });
        await clearCredentials(api);
    }
    if (context.json) return json({ signed_out: Boolean(credentials) });
    line(credentials ? 'Signed out. The connection has been revoked.' : 'There was no sign-in to forget.');
}

export async function whoami(args, context) {
    parse(args, {});
    const me = await context.api.get('/me');
    if (context.json) return json(me);
    line(`${style.bold(me.email)}, ${me.plan} plan${process.env.SIGIL_API_KEY ? ' (API key)' : ''}`);
    describeDocuments(me);
    if (me.domains?.length) line(`Domains: ${me.domains.join(', ')}`);
}

function describeDocuments(me) {
    const d = me.documents || {};
    if (d.unmetered) return line('Documents: unmetered.');
    const monthly = d.monthly ? `${d.monthly.remaining} of ${d.monthly.granted} this month` : '';
    const packs = d.packs ? `${d.packs} from packs` : '';
    line(`Documents left: ${d.available ?? '?'}${monthly || packs ? ` (${[monthly, packs].filter(Boolean).join(', ')})` : ''}.`);
}
