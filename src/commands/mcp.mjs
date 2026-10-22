// sigil mcp: a stdio bridge to the hosted MCP server, for clients that can only start local servers. Each JSON-RPC
// message on stdin (one per line, the MCP stdio transport) is posted to {api}/mcp with the sign-in's token; the
// answer, JSON or an SSE stream of JSON-RPC messages, is written to stdout one message per line. The server's
// Mcp-Session-Id is carried from the initialize answer to every later request.

import readline from 'node:readline';
import { parse } from '../cli.mjs';
import { apiBase } from '../config.mjs';

export async function run(args, context) {
    parse(args, {});
    const url = `${apiBase()}/mcp`;
    let session = null;
    const out = message => process.stdout.write(JSON.stringify(message) + '\n');

    const post = async message => {
        const headers = {
            authorization: `Bearer ${await context.api.credential()}`,
            'content-type': 'application/json',
            accept: 'application/json, text/event-stream',
        };
        if (session) headers['mcp-session-id'] = session;
        let response = await fetch(url, { method: 'POST', headers, body: JSON.stringify(message) });
        if (response.status === 401 && !process.env.SIGIL_API_KEY) {
            await context.api.renew();
            headers.authorization = `Bearer ${await context.api.credential()}`;
            response = await fetch(url, { method: 'POST', headers, body: JSON.stringify(message) });
        }
        const sessionId = response.headers.get('mcp-session-id');
        if (sessionId) session = sessionId;
        if (response.status === 202 || response.status === 204) return;
        if (!response.ok) {
            const text = await response.text().catch(() => '');
            if (message.id !== undefined)
                out({ jsonrpc: '2.0', id: message.id, error: { code: response.status === 401 ? -32001 : -32000, message: `Sigil answered ${response.status}: ${text.slice(0, 300)}` } });
            else process.stderr.write(`sigil mcp: ${response.status} ${text.slice(0, 300)}\n`);
            return;
        }
        const type = response.headers.get('content-type') || '';
        if (type.includes('text/event-stream')) await pumpSse(response.body, out);
        else {
            const text = await response.text();
            if (text.trim()) {
                const parsed = JSON.parse(text);
                for (const item of Array.isArray(parsed) ? parsed : [parsed]) out(item);
            }
        }
    };

    const lines = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
    const inFlight = new Set();
    for await (const text of lines) {
        if (!text.trim()) continue;
        let message;
        try {
            message = JSON.parse(text);
        } catch {
            out({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } });
            continue;
        }
        const task = post(message).catch(error => {
            if (message.id !== undefined) out({ jsonrpc: '2.0', id: message.id, error: { code: -32000, message: error.message } });
            else process.stderr.write(`sigil mcp: ${error.message}\n`);
        }).finally(() => inFlight.delete(task));
        inFlight.add(task);
    }
    await Promise.all(inFlight);
}

/** Reads an SSE stream and emits each event's data as a JSON-RPC message. */
async function pumpSse(body, out) {
    const decoder = new TextDecoder();
    let buffer = '';
    let data = [];
    const flush = () => {
        if (data.length === 0) return;
        const text = data.join('\n');
        data = [];
        try {
            const parsed = JSON.parse(text);
            for (const item of Array.isArray(parsed) ? parsed : [parsed]) out(item);
        } catch {
            process.stderr.write(`sigil mcp: unreadable event: ${text.slice(0, 200)}\n`);
        }
    };
    for await (const chunk of body) {
        buffer += decoder.decode(chunk, { stream: true });
        let index;
        while ((index = buffer.indexOf('\n')) >= 0) {
            const raw = buffer.slice(0, index).replace(/\r$/, '');
            buffer = buffer.slice(index + 1);
            if (raw === '') flush();
            else if (raw.startsWith('data:')) data.push(raw.slice(5).replace(/^ /, ''));
            // event:, id:, retry: and comments are ignored
        }
    }
    flush();
}
