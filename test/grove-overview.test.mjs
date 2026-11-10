import test from 'node:test';
import assert from 'node:assert/strict';
import { searchesOf, overviewOf } from '../hq/grove-dashboard.js';

const row = (ts, via, query, rest) => ({ ts, kind: 'search', action: via, target: query, text: `Searched "${query}" (${via}): ${rest}` });

test('searchesOf reads the query, the article title and its link', () => {
  const [s] = searchesOf([row(5, 'wikipedia', 'koala facts', 'Koala (https://en.wikipedia.org/wiki/Koala)')]);
  assert.deepEqual(s, { ts: 5, query: 'koala facts', via: 'wikipedia', title: 'Koala', url: 'https://en.wikipedia.org/wiki/Koala' });
});

test('a search that found nothing has a null title and no link', () => {
  const [s] = searchesOf([row(6, 'wikipedia', 'gum leaves', 'nothing found')]);
  assert.equal(s.title, null);
  assert.equal(s.url, '');
});

test('searchesOf is newest first (rows arrive newest first) and capped', () => {
  const rows = Array.from({ length: 12 }, (_, i) => row(100 - i, 'research', `topic ${i}`, 'a fact'));
  const out = searchesOf(rows, 10);
  assert.equal(out.length, 10);
  assert.equal(out[0].query, 'topic 0');
});

test('searchesOf ignores rows that are not searches', () => {
  assert.deepEqual(searchesOf([{ kind: 'act', text: 'Ruby sat' }]), []);
});

test('overviewOf shows the wish, the drives, the searches and only the open tickets', () => {
  const o = overviewOf({
    koala: { id: 'ruby', name: 'Ruby', wish: 'Grow a garden' },
    needs: { rest: 0.2, curiosity: 0.9 },
    tickets: [
      { id: 1, koala: 'ruby', status: 'open', text: 'I wish: Grow a garden', created: 9 },
      { id: 2, koala: 'ruby', status: 'answered', text: 'old', created: 8 },
    ],
    searches: [{ query: 'moon' }],
  });
  assert.equal(o.name, 'Ruby');
  assert.equal(o.wish, 'Grow a garden');
  assert.deepEqual(o.drives, [{ name: 'rest', value: 0.2 }, { name: 'curiosity', value: 0.9 }]);
  assert.deepEqual(o.openTickets, [{ id: 1, text: 'I wish: Grow a garden', created: 9 }]);
  assert.deepEqual(o.searches, [{ query: 'moon' }]);
});

test('an empty grove gives an empty overview, not a blank one', () => {
  assert.deepEqual(overviewOf({}), { name: null, wish: null, drives: [], searches: [], openTickets: [] });
});
