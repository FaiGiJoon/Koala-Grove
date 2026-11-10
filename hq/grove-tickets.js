// Tickets: when a koala has a problem it can't solve ("we can't reach the sand"), it writes it
// down for the visitor. The visitor answers on the page; the answer reaches the koala's next prompt.

export const MAX_OPEN_TICKETS = 3; // per koala
const MAX_TEXT = 300;

// A new wish becomes a ticket, in the koala's own words: "I wish: ...".
export function wishTicketText(wish) {
  return `I wish: ${String(wish ?? '').trim()}`.slice(0, MAX_TEXT);
}

export class Tickets {
  constructor(db) {
    this.db = db;
    db.exec(`CREATE TABLE IF NOT EXISTS grove_tickets (
      id INTEGER PRIMARY KEY AUTOINCREMENT, koala TEXT NOT NULL, text TEXT NOT NULL,
      status TEXT NOT NULL, reply TEXT, created INTEGER NOT NULL, updated INTEGER NOT NULL)`);
    const p = (sql) => db.prepare(sql);
    this.q = {
      insert: p("INSERT INTO grove_tickets (koala, text, status, created, updated) VALUES (?, ?, 'open', ?, ?)"),
      get: p('SELECT * FROM grove_tickets WHERE id = ?'),
      set: p('UPDATE grove_tickets SET status = ?, reply = ?, updated = ? WHERE id = ?'),
      live: p("SELECT * FROM grove_tickets WHERE status != 'closed' ORDER BY id"),
      openCount: p("SELECT COUNT(*) AS n FROM grove_tickets WHERE koala = ? AND status = 'open'"),
    };
  }

  #shape(row) {
    return row ? { id: row.id, koala: row.koala, title: row.text.slice(0, 60), text: row.text, status: row.status, reply: row.reply ?? null } : null;
  }

  open(koala, text) {
    const t = String(text).trim().slice(0, MAX_TEXT);
    const now = Date.now();
    const { lastInsertRowid } = this.q.insert.run(koala, t, now, now);
    return this.get(Number(lastInsertRowid));
  }

  get(id) {
    return this.#shape(this.q.get.get(id));
  }

  reply(id, text) {
    const t = this.get(id);
    this.q.set.run('answered', String(text), Date.now(), id);
    return { ...t, status: 'answered', reply: String(text) };
  }

  close(id) {
    const t = this.get(id);
    this.q.set.run('closed', t?.reply ?? null, Date.now(), id);
    return { ...t, status: 'closed' };
  }

  list() {
    return this.q.live.all().map((r) => this.#shape(r));
  }

  openCount(koala) {
    return this.q.openCount.get(koala).n;
  }
}
