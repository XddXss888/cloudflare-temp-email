export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const auth = request.headers.get("Authorization");
    const adminAuth = request.headers.get("X-Admin-Auth");
    if (url.pathname.startsWith("/api/")) {
      if (!auth || !auth.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);
      const token = auth.slice(7);
      if (token !== "mytoken888") return json({ error: "Unauthorized" }, 401);
      if (request.method === "GET" && url.pathname === "/api/generate") return handleGenerate(env);
      if (request.method === "GET" && url.pathname === "/api/emails") return handleEmails(url, env);
      if (request.method === "DELETE" && url.pathname === "/api/mailboxes") return handleDelete(url, env);
      return json({ error: "Not Found" }, 404);
    }
    if (url.pathname.startsWith("/admin/")) {
      if (!adminAuth || adminAuth !== "mytoken888") return json({ error: "Unauthorized" }, 401);
      if (request.method === "POST" && url.pathname === "/admin/new_address") return handleAdminNewAddress(env);
      if (request.method === "GET" && url.pathname === "/admin/mails") return handleAdminMails(url, env);
      return json({ error: "Not Found" }, 404);
    }
    return json({ error: "Not Found" }, 404);
  },
  async email(message, env) {
    const to = message.to;
    const domains = env.DOMAINS.split(",").map((d) => d.trim());
    const matched = domains.some((d) => to.endsWith("." + d) || to.endsWith("@" + d));
    if (!matched) return;
    const from = message.from;
    const reader = message.raw.getReader();
    const chunks = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
    }
    const totalLength = chunks.reduce((sum, c) => sum + c.length, 0);
    const merged = new Uint8Array(totalLength);
    let offset = 0;
    for (const chunk of chunks) {
      merged.set(chunk, offset);
      offset += chunk.length;
    }
    const body = new TextDecoder().decode(merged);
    const subjectMatch = body.match(/^Subject:\s*(.+)$/mi);
    const subject = subjectMatch ? subjectMatch[1].trim() : "";
    const code = extractVerificationCode(body);
    await env.DB.prepare(
      "INSERT INTO mails (mailbox, subject, from_address, body, verification_code) VALUES (?, ?, ?, ?, ?)"
    ).bind(to, subject, from, body.substring(0, 5e4), code).run();
  }
};

function extractVerificationCode(body) {
  const codeRegex = /\b([A-Za-z0-9]{4,8})\b/;
  const plainMatch = body.match(/Content-Type: text\/plain[\s\S]*?(?===-|$)/i);
  if (plainMatch) {
    const textPart = plainMatch[0];
    if (textPart.includes("Content-Transfer-Encoding: base64")) {
      const base64Match = textPart.match(/[A-Za-z0-9+\/=]{20,}/);
      if (base64Match) {
        try {
          const decoded = atob(base64Match[0]);
          const codeMatch = decoded.match(codeRegex);
          if (codeMatch) return codeMatch[1];
        } catch (e) {
        }
      }
    } else {
      const codeMatch = textPart.match(codeRegex);
      if (codeMatch) return codeMatch[1];
    }
  }
  const subjectLines = body.split("\n");
  for (const line of subjectLines) {
    if (line.toLowerCase().startsWith("subject:")) {
      const codeMatch = line.match(codeRegex);
      if (codeMatch) return codeMatch[1];
    }
  }
  const bodyMatch = body.match(codeRegex);
  return bodyMatch ? bodyMatch[1] : null;
}

function generateAddress(env) {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let name = "", sub = "";
  for (let i = 0; i < 6; i++) name += chars[Math.floor(Math.random() * chars.length)];
  for (let i = 0; i < 6; i++) sub += chars[Math.floor(Math.random() * chars.length)];
  const domains = env.DOMAINS.split(",").map((d) => d.trim());
  const domain = domains[Math.floor(Math.random() * domains.length)];
  return name + "@" + sub + "." + domain;
}

async function handleGenerate(env) {
  const address = generateAddress(env);
  await env.DB.prepare("INSERT OR IGNORE INTO mail_boxes (address) VALUES (?)").bind(address).run();
  return json({ email: address });
}

async function handleAdminNewAddress(env) {
  const address = generateAddress(env);
  await env.DB.prepare("INSERT OR IGNORE INTO mail_boxes (address) VALUES (?)").bind(address).run();
  return json({ email: address, token: address });
}

async function handleEmails(url, env) {
  const mailbox = url.searchParams.get("mailbox");
  if (!mailbox) return json({ error: "mailbox required" }, 400);
  const result = await env.DB.prepare(
    "SELECT * FROM mails WHERE mailbox = ? ORDER BY created_at DESC LIMIT 10"
  ).bind(mailbox).all();
  return json(result.results || []);
}

async function handleAdminMails(url, env) {
  const address = url.searchParams.get("address");
  if (!address) return json({ error: "address required" }, 400);
  const limit = parseInt(url.searchParams.get("limit") || "20");
  const offset = parseInt(url.searchParams.get("offset") || "0");
  const result = await env.DB.prepare(
    "SELECT id, mailbox, subject, from_address, body, verification_code, created_at FROM mails WHERE mailbox = ? ORDER BY created_at DESC LIMIT ? OFFSET ?"
  ).bind(address, limit, offset).all();
  const mails = (result.results || []).map(m => ({
    id: m.id,
    mailbox: m.mailbox,
    subject: m.subject,
    from_address: m.from_address,
    raw: m.body,
    verification_code: m.verification_code,
    created_at: m.created_at
  }));
  return json({ results: mails });
}

async function handleDelete(url, env) {
  const address = url.searchParams.get("address");
  if (!address) return json({ error: "address required" }, 400);
  await env.DB.prepare("DELETE FROM mails WHERE mailbox = ?").bind(address).run();
  await env.DB.prepare("DELETE FROM mail_boxes WHERE address = ?").bind(address).run();
  return json({ success: true });
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}
