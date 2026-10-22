// The command line: `sigil <command> [subcommand] [options]`. Each command is a function (args, context) in
// src/commands; this file parses the global flags, dispatches, and turns errors into exit codes:
// 0 done, 1 the API or the sign-in refused (message on stderr), 2 usage.

import { parseArgs } from 'node:util';
import { createRequire } from 'node:module';
import { Api, ApiError, NotSignedIn } from './api.mjs';
import { apiBase } from './config.mjs';
import { line, warn } from './output.mjs';
import * as login from './commands/login.mjs';
import * as templates from './commands/templates.mjs';
import * as pacts from './commands/pacts.mjs';
import * as send from './commands/send.mjs';
import * as mcp from './commands/mcp.mjs';

const VERSION = createRequire(import.meta.url)('../package.json').version;

const COMMANDS = {
    login: login.login,
    logout: login.logout,
    whoami: login.whoami,
    templates: templates.run,
    pacts: pacts.run,
    send: send.run,
    mcp: mcp.run,
};

export const USAGE = `sigil: send documents for e-signature with Sigil.

  sigil login [--no-browser]           sign in with your Sigil account
  sigil logout                         forget the sign-in (and revoke it)
  sigil whoami                         the account, plan and documents left

  sigil templates list
  sigil templates show <uid>
  sigil templates upload <file> [--name "…"]
  sigil templates delete <uid>

  sigil pacts list [--status active|draft|sent|sealed|declined|voided|lapsed|all]
  sigil pacts show <uid> [--links]
  sigil pacts create (--template <uid> | --file <path>) --to "Name <email>"… [--cc …] [--title …] [--message …] [--lapse-days N] [--send]
  sigil pacts send <uid> [--lapse-days N]
  sigil pacts resend <uid>
  sigil pacts void <uid> [--reason "…"]
  sigil pacts download <uid> [--signed | --sigil] [-o file]

  sigil send <file|template-uid> --to "Name <email>"… [--cc …] [--title …] [--message …] [--lapse-days N]
                                       create and send in one go
  sigil mcp                            a stdio bridge to the hosted MCP server, with your sign-in

Options: --json (the API's response unchanged), --api <url> (another API host), --help, --version.
Environment: SIGIL_API_KEY (an API key instead of a sign-in), SIGIL_API (the API host), NO_COLOR.
Docs: https://docs.signwithsigil.com/cli`;

export async function run(argv) {
    let parsed;
    try {
        parsed = parseArgs({
            args: argv,
            options: { json: { type: 'boolean' }, api: { type: 'string' }, help: { type: 'boolean', short: 'h' }, version: { type: 'boolean', short: 'V' } },
            allowPositionals: true,
            strict: false,
        });
    } catch (error) {
        warn(error.message);
        return 2;
    }
    if (parsed.values.version) {
        line(VERSION);
        return 0;
    }
    const [command, ...rest] = parsed.positionals;
    if (parsed.values.help || !command) {
        line(USAGE);
        return command ? 0 : 2;
    }
    const handler = COMMANDS[command];
    if (!handler) {
        warn(`Unknown command "${command}".\n`);
        line(USAGE);
        return 2;
    }
    if (parsed.values.api) process.env.SIGIL_API = parsed.values.api;

    // The command re-parses its own options from the raw argv, minus the global ones and the command word.
    const own = argv.filter(a => !['--json', '--help', '-h', '--version', '-V'].includes(a) && !a.startsWith('--api='));
    const apiIndex = own.indexOf('--api');
    if (apiIndex >= 0) own.splice(apiIndex, 2);
    own.splice(own.indexOf(command), 1);

    const context = { api: new Api(apiBase()), json: Boolean(parsed.values.json), version: VERSION };
    try {
        const code = await handler(own, context);
        return code ?? 0;
    } catch (error) {
        if (error instanceof UsageError) {
            warn(error.message);
            return 2;
        }
        if (error instanceof NotSignedIn || error instanceof ApiError) {
            warn(error.message);
            if (error instanceof ApiError && error.status === 403) warn('Upgrade on https://www.signwithsigil.com/billing: the API needs the Pro or Business plan.');
            return 1;
        }
        warn(error.message || String(error));
        if (process.env.SIGIL_DEBUG) warn(error.stack);
        return 1;
    }
}

export class UsageError extends Error {}

/** parseArgs with the command's options; a parse failure or a missing positional is a usage error. */
export function parse(args, options, { positionals = 0 } = {}) {
    let parsed;
    try {
        parsed = parseArgs({ args, options, allowPositionals: true, strict: true });
    } catch (error) {
        throw new UsageError(error.message);
    }
    if (parsed.positionals.length < positionals) throw new UsageError(`Missing argument. Run "sigil --help".`);
    return parsed;
}
