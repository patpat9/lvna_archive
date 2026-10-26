/**
 * Lakewood Village Archive - Search Enhancer
 * Seamlessly upgrades MkDocs Material client-side search with:
 * 1. Exact phrase matching for quoted queries (e.g. "755 lakewood")
 * 2. Proximity and continuous phrase prioritization for natural queries (e.g. 755 lakewood)
 * 3. Accurate contextual snippets for matches deep inside long transcripts
 * 4. Preserves 100% native Material search UI, styling, keyboard shortcuts (/), and mobile dialogs.
 */
(function () {
  'use strict';

  const OriginalWorker = window.Worker;
  if (!OriginalWorker) return;

  // Cache full text of documents from initialization (type: 0)
  const fullDocMap = new Map();

  function cleanText(text) {
    if (!text) return '';
    return text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
  }

  function makeSnippet(fullText, query) {
    if (!fullText || !query) return null;
    const lower = fullText.toLowerCase();
    const cleanQ = query.trim().toLowerCase();
    const idx = lower.indexOf(cleanQ);
    if (idx === -1) return null;

    const start = Math.max(0, idx - 60);
    const end = Math.min(fullText.length, idx + query.length + 80);
    let snippet = fullText.slice(start, end).trim();
    if (start > 0) snippet = '...' + snippet;
    if (end < fullText.length) snippet = snippet + '...';

    // Highlight query terms safely
    const escaped = cleanQ.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`(${escaped})`, 'gi');
    return snippet.replace(regex, '<mark>$1</mark>');
  }

  function reRankItems(rawQuery, items) {
    if (!rawQuery || typeof rawQuery !== 'string' || !Array.isArray(items)) {
      return items;
    }

    const trimmed = rawQuery.trim();
    // Check if user requested an exact phrase via quotes
    const isQuoted = (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
                     (trimmed.startsWith("'") && trimmed.endsWith("'")) ||
                     trimmed.includes('"');

    const cleanQuery = trimmed.replace(/["'+]/g, '').trim().toLowerCase();
    const words = cleanQuery.split(/\s+/).filter(w => w.length > 0);

    // Single-word queries use standard Lunr BM25 scoring
    if (words.length <= 1) {
      return items;
    }

    const scoredGroups = [];

    for (const group of items) {
      if (!Array.isArray(group)) continue;
      let groupHasExactPhrase = false;
      let groupMaxScore = -Infinity;

      for (const sec of group) {
        const fullDoc = fullDocMap.get(sec.location);
        const titleStr = cleanText(fullDoc ? fullDoc.title : sec.title);
        const textStr = cleanText(fullDoc ? fullDoc.text : sec.text);
        const fullStr = titleStr + ' ' + textStr;

        let bonus = 0;

        // 1. Exact Full Phrase Match (Continuous)
        if (fullStr.includes(cleanQuery)) {
          bonus += 100000;
          groupHasExactPhrase = true;
          if (titleStr.includes(cleanQuery)) {
            bonus += 50000;
          }

          // If sec.text was truncated before reaching the match (e.g. in long transcripts),
          // synthesize an accurate highlighted snippet centered directly on the match
          if (fullDoc && fullDoc.text && !cleanText(sec.text).includes(cleanQuery)) {
            const customSnippet = makeSnippet(fullDoc.text, cleanQuery);
            if (customSnippet) {
              sec.text = customSnippet;
            }
          }
        } else {
          // 2. Sub-phrase pairs for queries with 3+ words (e.g. "755 lakewood drive")
          if (words.length >= 3) {
            for (let i = 0; i < words.length - 1; i++) {
              const pair = words[i] + ' ' + words[i + 1];
              if (fullStr.includes(pair)) {
                bonus += 15000;
                groupHasExactPhrase = true;
              }
            }
          }

          // 3. Proximity scoring (words close to each other)
          const allWordsPresent = words.every(w => fullStr.includes(w));
          if (allWordsPresent) {
            bonus += 1000;
            const idx1 = fullStr.indexOf(words[0]);
            const idx2 = fullStr.indexOf(words[1]);
            if (idx1 !== -1 && idx2 !== -1) {
              const dist = Math.abs(idx1 - idx2);
              if (dist < 120) {
                bonus += Math.max(0, 1000 - dist * 8);
              }
            }
          }
        }

        sec.score = (sec.score || 1) + bonus;
        if (sec.score > groupMaxScore) {
          groupMaxScore = sec.score;
        }
      }

      // If user wrapped query in quotes, filter out documents without exact continuous phrase
      if (isQuoted && !groupHasExactPhrase) {
        continue;
      }

      // Sort sections within this page group so the best match is top
      group.sort((a, b) => (b.score || 0) - (a.score || 0));
      group._rankScore = groupMaxScore;
      scoredGroups.push(group);
    }

    // Sort documents descending by their highest scoring section
    scoredGroups.sort((a, b) => (b._rankScore || 0) - (a._rankScore || 0));
    return scoredGroups;
  }

  // Intercept Worker to augment search results seamlessly
  window.Worker = class extends OriginalWorker {
    constructor(scriptUrl, options) {
      super(scriptUrl, options);

      const urlStr = scriptUrl ? scriptUrl.toString() : '';
      if (!urlStr.includes('search') && !urlStr.includes('worker')) {
        return;
      }

      let currentQuery = '';

      // Intercept outgoing messages to worker
      const origPostMessage = this.postMessage.bind(this);
      this.postMessage = (msg) => {
        // Intercept index initialization (type: 0) to cache full documents
        if (msg && msg.type === 0 && msg.data && Array.isArray(msg.data.docs)) {
          for (const doc of msg.data.docs) {
            if (doc && doc.location) {
              fullDocMap.set(doc.location, {
                title: doc.title || '',
                text: doc.text || ''
              });
            }
          }
        }

        // Intercept search queries (type: 2)
        if (msg && msg.type === 2 && typeof msg.data === 'string') {
          currentQuery = msg.data;
        }

        return origPostMessage(msg);
      };

      // Intercept incoming search results via addEventListener
      const origAddEventListener = this.addEventListener.bind(this);
      this.addEventListener = (type, listener, opts) => {
        if (type === 'message') {
          const wrappedListener = (event) => {
            if (event && event.data && event.data.type === 3 && event.data.data && Array.isArray(event.data.data.items)) {
              event.data.data.items = reRankItems(currentQuery, event.data.data.items);
            }
            return listener(event);
          };
          return origAddEventListener(type, wrappedListener, opts);
        }
        return origAddEventListener(type, listener, opts);
      };

      // Intercept incoming search results via onmessage setter
      let customOnMessage = null;
      Object.defineProperty(this, 'onmessage', {
        get() {
          return customOnMessage;
        },
        set(fn) {
          customOnMessage = fn;
          super.onmessage = (event) => {
            if (event && event.data && event.data.type === 3 && event.data.data && Array.isArray(event.data.data.items)) {
              event.data.data.items = reRankItems(currentQuery, event.data.data.items);
            }
            if (customOnMessage) {
              customOnMessage.call(this, event);
            }
          };
        }
      });
    }
  };
})();
