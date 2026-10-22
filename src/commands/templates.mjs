import { promises as fs } from 'node:fs';
import { UsageError, parse } from '../cli.mjs';
import { date, json, line, style, table } from '../output.mjs';

export async function run(args, context) {
    const [sub, ...rest] = args;
    switch (sub) {
        case 'list': return list(rest, context);
        case 'show': return show(rest, context);
        case 'upload': return upload(rest, context);
        case 'delete': return remove(rest, context);
        default: throw new UsageError('sigil templates list | show <uid> | upload <file> [--name "…"] | delete <uid>');
    }
}

async function list(args, context) {
    parse(args, {});
    const result = await context.api.get('/templates');
    if (context.json) return json(result);
    table(result.data || [], [
        ['UID', t => t.uid], ['Name', t => t.name], ['Pages', t => t.page_count], ['Signers', t => t.signer_count], ['Fields', t => t.field_count], ['Created', t => date(t.date_created)],
    ]);
}

async function show(args, context) {
    const { positionals } = parse(args, {}, { positionals: 1 });
    const t = await context.api.get(`/templates/${encodeURIComponent(positionals[0])}`);
    if (context.json) return json(t);
    line(`${style.bold(t.name)} (${t.uid}): ${t.source_name}, ${t.page_count} page${t.page_count === 1 ? '' : 's'}, ${t.signer_count} signer${t.signer_count === 1 ? '' : 's'}`);
    table(t.fields || [], [['Signer', f => f.recipient], ['Type', f => f.type], ['Page', f => f.page], ['Label', f => f.label], ['Required', f => (f.required ? 'yes' : 'no')]]);
}

export async function upload(args, context) {
    const { values, positionals } = parse(args, { name: { type: 'string' } }, { positionals: 1 });
    const file = positionals[0];
    await fs.access(file).catch(() => { throw new UsageError(`No such file: ${file}`); });
    const t = await context.api.upload('/templates', { file, name: values.name });
    if (context.json) return json(t);
    line(`${style.green('Uploaded')} ${style.bold(t.name)} as template ${t.uid}: ${t.signer_count} signer${t.signer_count === 1 ? '' : 's'}, ${t.field_count} field${t.field_count === 1 ? '' : 's'}.`);
    return t;
}

async function remove(args, context) {
    const { positionals } = parse(args, {}, { positionals: 1 });
    await context.api.delete(`/templates/${encodeURIComponent(positionals[0])}`);
    if (context.json) return json({ deleted: positionals[0] });
    line(`Template ${positionals[0]} deleted. Pacts made from it keep their own copy.`);
}
