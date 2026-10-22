# Sigil CLI

`sigil` sends documents for e-signature with [Sigil](https://www.signwithsigil.com) from the shell, scripts and
coding agents: upload a PDF or Word file, send it as a pact, see who has signed, download the signed copy and its
certificate of completion. Sign in once with your Sigil account; no key to manage.

```bash
npm install -g @signwithsigil/cli
sigil login
sigil send agreement.pdf --to "Avery Lane <avery@example.com>" --to "Sam Ortiz <sam@example.com>"
sigil pacts list --status sent
```

Needs Node.js 20 or later and a Sigil account on the Pro or Business plan (the API and the CLI are part of those
plans). No other dependencies.

## Sign in

`sigil login` opens your browser on a Sigil page; log in and allow the connection. The CLI keeps its tokens in
`~/.config/sigil/credentials.json` (`%APPDATA%\sigil` on Windows), readable only by you, and refreshes them on its
own. `sigil logout` forgets the sign-in and revokes it on the server; `sigil whoami` shows the account, plan and
documents left. Connections also appear, and can be disconnected, on the API page of your Sigil dashboard.

Where a browser is not available, such as CI, set an API key instead; it takes precedence over a sign-in:

```bash
export SIGIL_API_KEY="sgk_…"
```

## Send a document

Fields are [glyphs](https://docs.signwithsigil.com/concepts/glyphs) typed into the document (`\s1\` for the first
signer's signature, `\d1\` for the date, and so on). Give the file, or a saved template's id, and one `--to` per signer
in signing order:

```bash
sigil send agreement.pdf \
  --to "Avery Lane <avery@example.com>" \
  --to "Sam Ortiz <sam@example.com>" \
  --cc records@example.com \
  --title "Consulting agreement with Acme" \
  --message "Please sign by Friday." \
  --lapse-days 14
```

```
Pact 7DXW69YJ sent: 2 signers, 1 document used.
Avery Lane <avery@example.com> has been emailed their signing link.
```

Sending uses one document per 3 signers (CCs are free); the command refuses, before anything is sent, when the account
has too few left.

## Commands

| Command | What it does |
|---|---|
| `sigil login` / `sigil logout` / `sigil whoami` | Sign in and out; show the account. `--no-browser` prints the URL to open by hand. |
| `sigil templates list` | Saved templates. |
| `sigil templates show <uid>` | One template with its fields. |
| `sigil templates upload <file> [--name …]` | Upload a PDF or Word file as a template. |
| `sigil templates delete <uid>` | Delete a template; pacts made from it keep their copy. |
| `sigil pacts list [--status active\|draft\|sent\|sealed\|declined\|voided\|lapsed\|all]` | Pacts, newest first. |
| `sigil pacts show <uid>` | One pact: recipients and their status, fields, events, download links. |
| `sigil pacts create (--template <uid> \| --file <path>) --to … [--cc …] [--title …] [--message …] [--lapse-days N] [--send]` | A draft, or sent straight away with `--send`. |
| `sigil pacts send <uid> [--lapse-days N]` | Send a draft. |
| `sigil pacts resend <uid>` | A fresh link for the signer whose turn it is. |
| `sigil pacts void <uid> [--reason …]` | Withdraw a pact that is out for signature. |
| `sigil pacts download <uid> [--signed \| --sigil] [-o file]` | The document as sent, the signed copy, or the sigil (certificate of completion). |
| `sigil send <file\|uid> --to …` | Create and send in one go. |
| `sigil mcp` | A stdio bridge to the hosted MCP server, for clients that only start local servers. |

Every command takes `--json` to print the API's response unchanged, for scripts:

```bash
sigil pacts list --status sent --json | jq '.data[] | {uid, title, status}'
```

Exit codes: `0` success, `1` the API refused (the message is on stderr, in the API's words), `2` usage.

## In a coding agent

Claude Code, Codex and Cursor can run `sigil` like any other command once it is installed and signed in. It is the
companion to the hosted [Sigil MCP server](https://docs.signwithsigil.com/mcp), which can only send templates that are
already uploaded: the CLI uploads the file in front of it. `sigil mcp` bridges stdin/stdout to that server for clients
that cannot connect to an HTTP MCP server themselves.

## Environment

| Variable | Use |
|---|---|
| `SIGIL_API_KEY` | An API key instead of a sign-in (CI). |
| `SIGIL_API` | Another API host (also `--api <url>`). Default `https://api.signwithsigil.com`; the sign-in page is found from it. |
| `NO_COLOR` | Plain output. |

## Documentation

- The guide, with every command: https://docs.signwithsigil.com/cli
- The API the CLI calls: https://docs.signwithsigil.com
- How sign-in works: https://docs.signwithsigil.com/mcp/oauth
- Questions and problems: https://www.signwithsigil.com/contact, or an issue on this repository.

## Development

No dependencies, no build step. `npm test` runs the tests (`node:test`, including a fake token server for the
refresh flow). To run against another Sigil instance, point `SIGIL_API` at it: `SIGIL_API=http://localhost:5402 node
bin/sigil.mjs login`. `npm pack` makes the tarball that `npm publish` uploads.

## License

[MIT](LICENSE). Sigil is a product of Darklight Interactive.
