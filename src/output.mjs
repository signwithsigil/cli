// What the user sees: a table, a few lines, or the API's JSON unchanged with --json.

const color = !process.env.NO_COLOR && process.stdout.isTTY;

export const style = {
    bold: s => (color ? `\x1b[1m${s}\x1b[0m` : s),
    dim: s => (color ? `\x1b[2m${s}\x1b[0m` : s),
    red: s => (color ? `\x1b[31m${s}\x1b[0m` : s),
    green: s => (color ? `\x1b[32m${s}\x1b[0m` : s),
};

export function json(value) {
    process.stdout.write(JSON.stringify(value, null, 2) + '\n');
}

export function line(text = '') {
    process.stdout.write(text + '\n');
}

export function warn(text) {
    process.stderr.write(style.red(text) + '\n');
}

/** A plain table: `columns` is [[header, row => cell], …]. */
export function table(rows, columns) {
    if (rows.length === 0) {
        line(style.dim('(none)'));
        return;
    }
    const cells = rows.map(row => columns.map(([, pick]) => String(pick(row) ?? '')));
    const widths = columns.map(([header], i) => Math.max(header.length, ...cells.map(c => c[i].length)));
    const render = parts => parts.map((p, i) => p.padEnd(widths[i])).join('  ').trimEnd();
    line(style.bold(render(columns.map(([header]) => header))));
    for (const row of cells) line(render(row));
}

export function date(value) {
    if (!value) return '';
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? String(value) : d.toISOString().slice(0, 16).replace('T', ' ') + 'Z';
}

export function plural(count, word) {
    return `${count} ${word}${count === 1 ? '' : 's'}`;
}
