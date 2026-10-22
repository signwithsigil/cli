import { promises as fs } from 'node:fs';
import { UsageError, parse } from '../cli.mjs';
import { date, json, line, plural, style, table } from '../output.mjs';
import { parseRecipients } from '../recipients.mjs';

export async function run(args, context) {
    const [sub, ...rest] = args;
    switch (sub) {
        case 'list': return list(rest, context);
        case 'show': return show(rest, context);
        case 'create': return create(rest, context);
        case 'send': return send(rest, context);
        case 'resend': return resend(rest, context);
        case 'void': return voidPact(rest, context);
        case 'download': return download(rest, context);
        default: throw new UsageError('sigil pacts list | show <uid> | create … | send <uid> | resend <uid> | void <uid> | download <uid>');
    }
}

const STATUSES = ['active', 'all', 'draft', 'sent', 'sealed', 'declined', 'voided', 'lapsed'];

async function list(args, context) {
    const { values } = parse(args, { status: { type: 'string' }, limit: { type: 'string' } });
    if (values.status && !STATUSES.includes(values.status)) throw new UsageError(`--status must be one of ${STATUSES.join(', ')}.`);
    const result = await context.api.get('/pacts', { status: values.status, limit: values.limit });
    if (context.json) return json(result);
    table(result.data || [], [
        ['UID', p => p.uid], ['Status', p => p.status], ['Title', p => p.title],
        ['Signers', p => (p.recipients || []).filter(r => r.role === 'signer').map(r => `${r.name} (${r.status})`).join(', ')],
        ['Sent', p => date(p.date_sent)],
    ]);
    if (result.total > (result.data || []).length) line(style.dim(`${result.total} in all; --limit up to 200.`));
}

async function show(args, context) {
    const { values, positionals } = parse(args, { links: { type: 'boolean' } }, { positionals: 1 });
    const p = await context.api.get(`/pacts/${encodeURIComponent(positionals[0])}`, { include_links: values.links ? 1 : undefined });
    if (context.json) return json(p);
    describe(p, values.links);
}

export const CREATE_OPTIONS = {
    template: { type: 'string' }, file: { type: 'string' },
    to: { type: 'string', multiple: true }, cc: { type: 'string', multiple: true },
    title: { type: 'string' }, message: { type: 'string' }, 'lapse-days': { type: 'string' }, domain: { type: 'string' },
};

/** Builds and posts a pact from the create options; `sendNow` sends it in the same call. */
export async function createPact(values, context, sendNow) {
    if (!values.template === !values.file) throw new UsageError('Give exactly one of --template <uid> or --file <path>.');
    const recipients = parseRecipients(values.to, values.cc);
    const lapse = values['lapse-days'] === undefined ? undefined : Number(values['lapse-days']);
    if (lapse !== undefined && !(Number.isInteger(lapse) && lapse > 0)) throw new UsageError('--lapse-days must be a whole number of days.');
    const body = { title: values.title, message: values.message, lapse_days: lapse, domain_host: values.domain, send: sendNow || undefined };

    if (values.file) {
        await fs.access(values.file).catch(() => { throw new UsageError(`No such file: ${values.file}`); });
        return context.api.upload('/pacts', { file: values.file, recipients, ...Object.fromEntries(Object.entries(body).filter(([, v]) => v !== undefined).map(([k, v]) => [k, String(v)])) });
    }
    return context.api.post('/pacts', { template_uid: values.template, recipients, ...body });
}

async function create(args, context) {
    const { values } = parse(args, { ...CREATE_OPTIONS, send: { type: 'boolean' } });
    const p = await createPact(values, context, values.send);
    if (context.json) return json(p);
    report(p);
}

async function send(args, context) {
    const { values, positionals } = parse(args, { 'lapse-days': { type: 'string' } }, { positionals: 1 });
    const lapse = values['lapse-days'] === undefined ? undefined : Number(values['lapse-days']);
    const p = await context.api.post(`/pacts/${encodeURIComponent(positionals[0])}/send`, lapse === undefined ? {} : { lapse_days: lapse });
    if (context.json) return json(p);
    report(p);
}

async function resend(args, context) {
    const { positionals } = parse(args, {}, { positionals: 1 });
    const p = await context.api.post(`/pacts/${encodeURIComponent(positionals[0])}/resend`, {});
    if (context.json) return json(p);
    const current = (p.recipients || []).find(r => r.order === p.current_signer);
    line(`${style.green('Resent')}: ${current ? `${current.name} <${current.email}>` : 'the current signer'} has a fresh link; the old one no longer works.`);
}

async function voidPact(args, context) {
    const { values, positionals } = parse(args, { reason: { type: 'string' } }, { positionals: 1 });
    const p = await context.api.post(`/pacts/${encodeURIComponent(positionals[0])}/void`, values.reason ? { reason: values.reason } : {});
    if (context.json) return json(p);
    line(`Pact ${p.uid} voided. Its signing links no longer work${values.reason ? '; the current signer was told why' : ''}.`);
}

async function download(args, context) {
    const { values, positionals } = parse(args, { signed: { type: 'boolean' }, sigil: { type: 'boolean' }, output: { type: 'string', short: 'o' } }, { positionals: 1 });
    if (values.signed && values.sigil) throw new UsageError('Choose --signed or --sigil, not both.');
    const uid = positionals[0];
    const name = values.sigil ? 'sigil.pdf' : values.signed ? 'signed.pdf' : 'document.pdf';
    const response = await context.api.download(`/pacts/${encodeURIComponent(uid)}/${name}`);
    const target = values.output || `${uid}-${name}`;
    await fs.writeFile(target, Buffer.from(await response.arrayBuffer()));
    if (context.json) return json({ file: target });
    line(`Saved ${target}.`);
}

/** After create or send: what happened, in one or two lines. */
export function report(p) {
    const signers = (p.recipients || []).filter(r => r.role === 'signer');
    if (p.status === 'draft') {
        line(`Pact ${style.bold(p.uid)} is a draft: ${plural(signers.length, 'signer')}, would use ${plural(p.documents_cost ?? '?', 'document')}. Send it with: sigil pacts send ${p.uid}`);
        return;
    }
    line(`Pact ${style.bold(p.uid)} ${style.green(p.status)}: ${plural(signers.length, 'signer')}, ${plural(p.documents_charged ?? 0, 'document')} used.`);
    const current = signers.find(r => r.order === p.current_signer);
    if (current) line(`${current.name} <${current.email}> has been emailed their signing link.`);
    if (p.warning) line(style.red(`Warning: ${p.warning}`));
}

function describe(p, withLinks) {
    line(`${style.bold(p.title || '(untitled)')} (${p.uid}): ${p.status}${p.date_sent ? `, sent ${date(p.date_sent)}` : ''}${p.date_sealed ? `, sealed ${date(p.date_sealed)}` : ''}${p.date_lapses ? `, lapses ${date(p.date_lapses)}` : ''}`);
    table(p.recipients || [], [
        ['#', r => r.order ?? ''], ['Role', r => r.role], ['Name', r => r.name], ['Email', r => r.email], ['Status', r => r.status],
        ['Signed', r => date(r.date_signed)], ...(withLinks ? [['Signing link', r => r.signing_url || '']] : []),
    ]);
    if (p.links) {
        line('');
        line(`Document: ${p.links.document}`);
        if (p.status === 'sealed') line(`Signed:   ${p.links.signed}\nSigil:    ${p.links.sigil}`);
        if (p.links.dashboard) line(`Dashboard: ${p.links.dashboard}`);
    }
}
