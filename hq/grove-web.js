// The real web for a koala on the free brain: Wikipedia needs no key and no tokens.
// The local model turns the article into something the koala remembers.

const API = 'https://en.wikipedia.org/w/api.php';
const COMMON = new Set(['what', 'when', 'where', 'which', 'does', 'with', 'that', 'this', 'from', 'about', 'have', 'your']);

const words = (text) => String(text).toLowerCase().split(/[^\p{L}\p{N}]+/u).map((w) => w.replace(/s$/, ''));

// Search matches loosely, so an article counts only if its title shares a real word with the topic.
function aboutTopic(title, topic) {
  const inTitle = new Set(words(title));
  return words(topic).some((w) => w.length > 3 && !COMMON.has(w) && inTitle.has(w));
}

export function createWeb({ fetchImpl = globalThis.fetch, timeoutMs = 10000 } = {}) {
  return {
    // The best article for a topic: { title, extract, url }, or null when there is none.
    async lookup(topic) {
      const params = new URLSearchParams({
        action: 'query', format: 'json', formatversion: '2',
        generator: 'search', gsrsearch: String(topic).slice(0, 200), gsrlimit: '1',
        prop: 'extracts|info', inprop: 'url', exintro: '1', explaintext: '1', exchars: '1200',
      });
      try {
        const res = await fetchImpl(`${API}?${params}`, {
          headers: { 'user-agent': 'koala-grove' },
          signal: AbortSignal.timeout(timeoutMs),
        });
        if (!res.ok) return null;
        const page = (await res.json())?.query?.pages?.[0];
        const extract = typeof page?.extract === 'string' ? page.extract.trim() : '';
        return extract && aboutTopic(page.title, topic) ? { title: String(page.title), extract, url: page.fullurl ?? '' } : null;
      } catch {
        return null;
      }
    },
  };
}
