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

  if (typeof window === 'undefined' || window.__lvna_search_enhanced) return;
  window.__lvna_search_enhanced = true;

  const OriginalWorker = window.Worker;
  if (!OriginalWorker) return;

  const fullDocMap = new Map();
  let currentQuery = '';

  function normalize(text) {
    if (!text) return '';
    return text
      .replace(/<[^>]+>/g, ' ')
      .replace(/[^\w\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
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

    const escaped = cleanQ.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`(${escaped})`, 'gi');
    return snippet.replace(regex, '<mark>$1</mark>');
  }

  function getActiveQuery() {
    try {
      const input = document.querySelector('[data-md-component=search-query]');
      if (input && typeof input.value === 'string' && input.value.trim()) {
        return input.value;
      }
    } catch (e) {}
    return currentQuery;
  }

  function reRankItems(rawQuery, items) {
    if (!rawQuery || typeof rawQuery !== 'string' || !Array.isArray(items)) {
      return items;
    }

    const trimmed = rawQuery.trim();
    const isQuoted = (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
                     (trimmed.startsWith("'") && trimmed.endsWith("'")) ||
                     trimmed.includes('"');

    const normQuery = normalize(trimmed);
    const words = normQuery.split(/\s+/).filter(w => w.length > 0);

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
        const titleStr = normalize(fullDoc ? fullDoc.title : sec.title);
        const textStr = normalize(fullDoc ? fullDoc.text : sec.text);
        const fullStr = titleStr + ' ' + textStr;

        let bonus = 0;

        // Foundational reference pages (History, Guides, Activities, LVNA Governance) receive a priority bonus
        if (!sec.location.startsWith('Villager/Issues/')) {
          bonus += 5000;
        }

        // 1. Exact Full Continuous Phrase Match
        if (fullStr.includes(normQuery)) {
          bonus += 1000000;
          groupHasExactPhrase = true;
          if (titleStr.includes(normQuery)) {
            bonus += 100000;
          }

          // Generate accurate highlighted snippet if original snippet truncated before match
          if (fullDoc && fullDoc.text && !normalize(sec.text).includes(normQuery)) {
            const customSnippet = makeSnippet(fullDoc.text, trimmed.replace(/["']/g, ''));
            if (customSnippet) {
              sec.text = customSnippet;
            }
          }
        } else {
          // 2. Check if all query words are present
          const allWordsPresent = words.every(w => fullStr.includes(w));
          if (allWordsPresent) {
            bonus += 50000;
            // Proximity bonus
            const idx1 = fullStr.indexOf(words[0]);
            const idx2 = fullStr.indexOf(words[1]);
            if (idx1 !== -1 && idx2 !== -1) {
              const dist = Math.abs(idx1 - idx2);
              if (dist < 150) {
                bonus += Math.max(0, 5000 - dist * 30);
              }
            }
          } else {
            // Missing words from multi-word query: heavily demote score
            bonus -= 10000;
          }
        }

        sec.score = (sec.score || 1) + bonus;
        if (sec.score > groupMaxScore) {
          groupMaxScore = sec.score;
        }
      }

      // If user wrapped query in quotes, exclude documents without exact continuous phrase
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

  function handleOutgoingMessage(msg) {
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
    if (msg && msg.type === 2 && typeof msg.data === 'string') {
      currentQuery = msg.data;
    }
  }

  function handleIncomingEvent(event) {
    if (event && event.data && event.data.type === 3 && event.data.data && Array.isArray(event.data.data.items)) {
      const q = getActiveQuery();
      event.data.data.items = reRankItems(q, event.data.data.items);
    }
  }

  // 1. Monkey-patch Prototype
  const origProtoPostMessage = OriginalWorker.prototype.postMessage;
  OriginalWorker.prototype.postMessage = function (msg) {
    handleOutgoingMessage(msg);
    return origProtoPostMessage.apply(this, arguments);
  };

  const origProtoAddEventListener = OriginalWorker.prototype.addEventListener;
  OriginalWorker.prototype.addEventListener = function (type, listener, opts) {
    if (type === 'message') {
      const wrappedListener = function (event) {
        handleIncomingEvent(event);
        return listener.apply(this, arguments);
      };
      return origProtoAddEventListener.call(this, type, wrappedListener, opts);
    }
    return origProtoAddEventListener.apply(this, arguments);
  };

  // 2. Monkey-patch Constructor and instances
  window.Worker = function (scriptUrl, options) {
    const worker = new OriginalWorker(scriptUrl, options);

    const instPostMessage = worker.postMessage.bind(worker);
    worker.postMessage = function (msg) {
      handleOutgoingMessage(msg);
      return instPostMessage.apply(this, arguments);
    };

    const instAddEventListener = worker.addEventListener.bind(worker);
    worker.addEventListener = function (type, listener, opts) {
      if (type === 'message') {
        const wrappedListener = function (event) {
          handleIncomingEvent(event);
          return listener.apply(this, arguments);
        };
        return instAddEventListener.call(this, type, wrappedListener, opts);
      }
      return instAddEventListener.apply(this, arguments);
    };

    return worker;
  };
  window.Worker.prototype = OriginalWorker.prototype;
})();
