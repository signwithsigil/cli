// sigil send <file | template-uid> --to … : create and send in one call. A path that exists is uploaded as a one-off
// document; anything else is taken as a saved template's uid.

import { promises as fs } from 'node:fs';
import { parse } from '../cli.mjs';
import { json } from '../output.mjs';
import { CREATE_OPTIONS, createPact, report } from './pacts.mjs';

export async function run(args, context) {
    const { values, positionals } = parse(args, CREATE_OPTIONS, { positionals: 1 });
    const what = positionals[0];
    const isFile = await fs.stat(what).then(s => s.isFile()).catch(() => false);
    const p = await createPact({ ...values, file: isFile ? what : undefined, template: isFile ? undefined : what }, context, true);
    if (context.json) return json(p);
    report(p);
}
