import http from 'node:http';
import crypto from 'node:crypto';

const PORT = Number.parseInt(process.env.PORT || '9999', 10);
const SECRET = String(process.env.PASSWORD_RESET_WEBHOOK_SECRET || '').trim();

function sign(secret, timestamp, body) {
  return crypto.createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
}

const server = http.createServer((req, res) => {
  const requestUrl = new URL(req.url || '/', `http://${req.headers.host || '127.0.0.1'}`);

  if (req.method !== 'POST' || requestUrl.pathname !== '/password-reset') {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: 'Not found' }));
    return;
  }

  const chunks = [];
  req.on('data', (chunk) => chunks.push(chunk));
  req.on('end', () => {
    const body = Buffer.concat(chunks).toString('utf8');
    const timestamp = String(req.headers['x-travelagent-timestamp'] || '');
    const signatureHeader = String(req.headers['x-travelagent-signature'] || '');
    const signature = signatureHeader.startsWith('v1=') ? signatureHeader.slice(3) : '';

    if (!SECRET) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'PASSWORD_RESET_WEBHOOK_SECRET is required for the mock receiver.' }));
      return;
    }

    const expected = sign(SECRET, timestamp, body);
    if (!timestamp || !signature || signature !== expected) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'Invalid signature' }));
      return;
    }

    let payload;
    try {
      payload = JSON.parse(body);
    } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'Invalid JSON body' }));
      return;
    }

    console.log('[mock-password-reset-webhook] accepted event');
    console.log(JSON.stringify({
      event: payload.event,
      event_id: payload.event_id,
      email: payload.recipient?.email,
      reset_url: payload.reset?.url,
      subject: payload.email_content?.subject,
    }, null, 2));

    res.writeHead(202, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
  });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[mock-password-reset-webhook] listening on http://127.0.0.1:${PORT}/password-reset`);
});