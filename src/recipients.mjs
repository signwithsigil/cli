// --to "Avery Lane <avery@example.com>" or --to avery@example.com, in signing order; --cc the same for copies.

const EMAIL = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;

export function parseRecipient(value, role = 'signer') {
    const text = String(value ?? '').trim();
    const angled = text.match(/^(.*?)\s*<([^<>]+)>$/);
    const name = angled ? angled[1].trim().replace(/^"(.*)"$/, '$1') : '';
    const email = (angled ? angled[2] : text).trim().toLowerCase();
    if (!EMAIL.test(email)) throw new Error(`Not an email address: "${text}". Use "Name <name@example.com>" or name@example.com.`);
    return { name: name || email.split('@')[0], email, role };
}

export function parseRecipients(to = [], cc = []) {
    const recipients = [...to.map(v => parseRecipient(v, 'signer')), ...cc.map(v => parseRecipient(v, 'cc'))];
    if (recipients.filter(r => r.role === 'signer').length === 0) throw new Error('At least one --to signer is required.');
    return recipients;
}
