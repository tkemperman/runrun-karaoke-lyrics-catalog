/* Shared by Firefox extension contexts and the Node test suite. */
(function (root) {
  "use strict";
  const id = () => globalThis.crypto.randomUUID();
  function block(text = "", start = null, end = null) {
    return { id: id(), start, end, text, translations: {} };
  }
  function project(videoId, title = "") {
    title = title.trim();
    return { schemaVersion: 5, display: displayDefaults(), furiganaEnabled: false, videoId, videoUrl: `https://www.youtube.com/watch?v=${videoId}`, videoTitle: title, title, artist: "", originalLanguage: "und", translationLanguage: "en", offset: 0, source: null, blocks: [] };
  }
  function displayDefaults() {
    return { captionGap: 0, lyricsColor: "#ffffff", translationColor: "#a5f3fc", sweepColor: "#f472b6", fontSize: 30, position: 13, translationFontSize: 23, translationPosition: 8, showOriginal: true, showTranslation: true, showNext: false };
  }
  function languages(value) {
    return [...new Set([value.translationLanguage, ...value.blocks.flatMap(row => Object.keys(row.translations))])].sort();
  }
  function singleTranslation(value) {
    const p = validate(value);
    for (const row of p.blocks) {
      row.translations = Object.hasOwn(row.translations, p.translationLanguage)
        ? { [p.translationLanguage]: row.translations[p.translationLanguage] } : {};
    }
    return p;
  }
  function renameTranslationLanguage(value, language) {
    if (typeof language !== 'string' || !/^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(language.trim())) throw new Error('Enter a language code such as en, nl or pt-BR.');
    language = language.trim();
    const p = singleTranslation(value), previous = p.translationLanguage;
    if (language === previous) return p;
    for (const row of p.blocks) {
      if (Object.hasOwn(row.translations, previous)) {
        row.translations[language] = row.translations[previous];
        delete row.translations[previous];
      }
    }
    p.translationLanguage = language;
    return p;
  }
  function exportProject(value) {
    const p = validate(value);
    // Normalize the saved copy without disrupting text currently being edited.
    for (const row of p.blocks) {
      const start = row.text.length - row.text.trimStart().length, end = row.text.trimEnd().length;
      if (row.furigana && (start || end !== row.text.length)) {
        let offset = 0;
        row.furigana = row.furigana.flatMap(([text, reading]) => {
          const trimmed = text.slice(Math.max(0, start - offset), Math.max(0, end - offset));
          offset += text.length;
          return trimmed ? [[trimmed, reading]] : [];
        });
      }
      if (row.sweep && (start || end !== row.text.length)) {
        let cursor = 0;
        row.sweep = row.sweep.flatMap(part => {
          const left = Math.max(0, start - cursor), right = Math.min(part.text.length, end - cursor);
          cursor += part.text.length;
          return right > left ? [{ ...part, text: part.text.slice(left, right) }] : [];
        });
      }
      if (row.sweep && !row.sweep.length) delete row.sweep;
      row.text = row.text.trim();
      row.translations = Object.fromEntries(Object.entries(row.translations).map(([language, text]) => [language, text.trim()]));
    }
    return { schemaVersion: p.schemaVersion, videoId: p.videoId, videoUrl: p.videoUrl, videoTitle: p.videoTitle,
      title: p.title, artist: p.artist, originalLanguage: p.originalLanguage, translationLanguage: p.translationLanguage,
      offset: p.offset, furiganaEnabled: p.furiganaEnabled, display: p.display, source: p.source,
      blocks: p.blocks.map(b => ({ id: b.id, text: b.text, start: b.start, end: b.end, translations: b.translations,
        ...(b.furigana ? { furigana: b.furigana } : {}), ...(b.sweep ? { sweep: b.sweep } : {}) })) };
  }
  function fingerprint(value) {
    const p = exportProject(value);
    return JSON.stringify(p);
  }
  function mergeTranslations(current, incoming) {
    const a = singleTranslation(current), b = singleTranslation(incoming);
    if (!a.blocks.length) return { project: b, conflicts: [], replacement: false };
    if (a.videoId !== b.videoId || a.blocks.length !== b.blocks.length ||
        (a.originalLanguage !== 'und' && b.originalLanguage !== 'und' && a.originalLanguage !== b.originalLanguage)) {
      return { project: b, conflicts: [], replacement: true };
    }
    const byId = new Map(b.blocks.map(row => [row.id, row]));
    let matched = a.blocks.map(row => byId.get(row.id));
    if (matched.some((row, i) => !row || row.text !== a.blocks[i].text)) {
      if (a.blocks.some((row, i) => row.text !== b.blocks[i].text)) return { project: b, conflicts: [], replacement: true };
      matched = b.blocks;
    }
    const conflicts = new Set();
    a.blocks.forEach((row, i) => {
      const previous = row.translations[a.translationLanguage] || '';
      const incoming = matched[i].translations[b.translationLanguage] || '';
      if (previous.trim() && (a.translationLanguage !== b.translationLanguage || previous !== incoming)) conflicts.add(a.translationLanguage);
      row.translations = { ...matched[i].translations };
    });
    a.translationLanguage = b.translationLanguage;
    if (a.originalLanguage === 'und') a.originalLanguage = b.originalLanguage;
    return { project: a, conflicts: [...conflicts], replacement: false };
  }
  function validate(value) {
    if (!value || ![1, 2, 3, 4, 5].includes(value.schemaVersion)) throw new Error("Unsupported project schema.");
    value = { ...value };
    if (value.schemaVersion === 1) {
      value.schemaVersion = 2;
      value.furiganaEnabled = false;
    }
    if (typeof value.furiganaEnabled !== "boolean") throw new Error("Invalid furigana visibility.");
    if (!/^[\w-]{11}$/.test(value.videoId)) throw new Error("Invalid YouTube video ID.");
    // The video ID is authoritative, including when importing older projects.
    value.videoUrl = `https://www.youtube.com/watch?v=${value.videoId}`;
    if (value.videoTitle === undefined) value.videoTitle = "";
    for (const key of ["videoTitle", "title", "artist", "originalLanguage", "translationLanguage"]) {
      if (typeof value[key] !== "string" || value[key].length > 2000) throw new Error(`Invalid ${key}.`);
    }
    value.videoTitle = value.videoTitle.trim();
    value.title = value.title.trim();
    if (!Number.isFinite(value.offset) || Math.abs(value.offset) > 86400) throw new Error("Invalid timing offset.");
    if (!Array.isArray(value.blocks) || value.blocks.length > 10000) throw new Error("Invalid block list.");
    if (value.schemaVersion < 3) {
      if (value.sources !== undefined) {
        if (!Array.isArray(value.sources) || value.sources.length > 100) throw new Error("Invalid sources.");
        value.source = value.sources.at(-1) ?? null;
      }
      value.schemaVersion = 3;
    }
    delete value.sources;
    const ids = new Set();
    for (const row of value.blocks) {
      if (!row || typeof row.id !== "string" || !row.id || ids.has(row.id)) throw new Error("Block IDs must be unique.");
      ids.add(row.id);
      if (typeof row.text !== "string" || row.text.length > 20000) throw new Error("Invalid lyrics text.");
      if (row.furigana !== undefined) validateFurigana(row.text, row.furigana);
      for (const key of ["start", "end"]) {
        if (row[key] !== null && (!Number.isFinite(row[key]) || row[key] < 0 || row[key] > 86400)) throw new Error("Times must be seconds between 0 and 86400, or blank.");
      }
      if (row.start === null && row.end !== null) throw new Error("Set a start before an end time.");
      if (row.end !== null && row.end <= row.start) throw new Error("End time must be after start time.");
      if (row.sweep !== undefined) validateSweep(row);
      if (!row.translations || typeof row.translations !== "object" || Array.isArray(row.translations)) throw new Error("Invalid translations.");
      for (const [language, text] of Object.entries(row.translations)) {
        if (!/^[a-zA-Z]{2,8}(-[a-zA-Z0-9]{1,8})*$/.test(language) || typeof text !== "string" || text.length > 20000) throw new Error("Invalid translation entry.");
      }
    }
    const source = value.source;
    if (source !== null) {
      if (!source || Array.isArray(source) || typeof source.provider !== "string" || typeof source.url !== "string" || !/^https:\/\//.test(source.url)) throw new Error("Invalid source link.");
      value.source = { provider: source.provider, url: source.url };
    }
    const display = { ...displayDefaults(), ...(value.display || {}) };
    if (!Number.isFinite(display.captionGap) || display.captionGap < -30 || display.captionGap > 30) throw new Error('Invalid caption spacing.');
    // Migrate the former negative-spacing experiment to the closest text fit.
    display.captionGap = Math.max(0, display.captionGap);
    for (const key of ['lyricsColor', 'translationColor', 'sweepColor']) {
      if (typeof display[key] !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(display[key])) throw new Error(`Invalid ${key === 'sweepColor' ? 'highlight' : key} color.`);
    }
    for (const key of ['fontSize', 'translationFontSize']) if (!Number.isFinite(display[key]) || display[key] < 12 || display[key] > 80) throw new Error('Invalid text size.');
    for (const key of ['position', 'translationPosition']) if (!Number.isFinite(display[key]) || display[key] < 0 || display[key] > 90) throw new Error('Invalid text position.');
    for (const key of ['showOriginal', 'showTranslation', 'showNext']) if (typeof display[key] !== 'boolean') throw new Error('Invalid text visibility.');
    value.display = Object.fromEntries(Object.keys(displayDefaults()).map(key => [key, display[key]]));
    value.schemaVersion = 5;
    return JSON.parse(JSON.stringify(value));
  }
  // Sweep timestamps share the block clock: video seconds minus project.offset.
  function validateSweep(row) {
    if (!Array.isArray(row.sweep) || !row.sweep.length || row.sweep.length > row.text.length || row.start === null || row.end === null) throw new Error("Sweep needs timed segments and a timed line.");
    let previous = row.start;
    for (const part of row.sweep) {
      if (!part || typeof part.text !== "string" || !part.text || !Number.isFinite(part.start) || !Number.isFinite(part.end) || part.start < previous || part.end <= part.start || part.end > row.end) throw new Error("Invalid sweep: segments must be ordered, non-overlapping and inside the line.");
      previous = part.end;
    }
    if (row.sweep.map(part => part.text).join("") !== row.text) throw new Error("Sweep segments must exactly match the original lyrics.");
    // Do not split surrogate pairs, combining characters or emoji sequences.
    const boundaries = new Set([...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(row.text)].map(part => part.index));
    let cursor = 0;
    for (const part of row.sweep) {
      if (!boundaries.has(cursor)) throw new Error("Sweep boundaries must not split a grapheme.");
      cursor += part.text.length;
    }
    return row.sweep;
  }
  function sweepPosition(row, videoTime, offset = 0) {
    const time = videoTime - offset;
    let cursor = 0;
    for (const part of row.sweep || []) {
      if (time <= part.start) return cursor;
      if (time < part.end) return cursor + part.text.length * (time - part.start) / (part.end - part.start);
      cursor += part.text.length;
    }
    return cursor;
  }
  function validateFurigana(text, parts) {
    const kana = /^[\p{Script=Hiragana}\p{Script=Katakana}ー・\s]+$/u;
    const validAnnotation = (base, annotation) => {
      if (typeof annotation !== "string" || annotation.length > 1000) return false;
      if (kana.test(annotation)) return true;
      // Manual reverse ruby keeps the sung kana below its kanji spelling.
      return kana.test(base) && /[\p{Script=Hiragana}\p{Script=Katakana}]/u.test(base) &&
        /[\p{Script=Han}]/u.test(annotation) && /^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}ー・\s]+$/u.test(annotation);
    };
    if (!Array.isArray(parts) || parts.length > text.length || parts.some(part =>
      !Array.isArray(part) || part.length !== 2 || typeof part[0] !== "string" || !part[0] ||
      (part[1] !== null && !validAnnotation(part[0], part[1]))) ||
      parts.map(part => part[0]).join("") !== text) throw new Error("Invalid furigana: segments must exactly match the original lyrics; annotations must be kana, or kanji above kana text.");
    return parts;
  }
  function replaceFuriganaTerm(text, parts, term, reading) {
    if (!term || !/[\p{Script=Han}]/u.test(term)) throw new Error("Enter a term containing kanji.");
    validateFurigana(term, [[term, reading]]);
    validateFurigana(text, parts);
    const spans = [];
    let position = 0;
    for (const [base, annotation] of parts) {
      spans.push({ start: position, end: position + base.length, base, annotation });
      position += base.length;
    }
    const result = [];
    const appendRange = (start, end) => {
      for (const span of spans) {
        const left = Math.max(start, span.start), right = Math.min(end, span.end);
        if (left < right) result.push([text.slice(left, right), left === span.start && right === span.end ? span.annotation : null]);
      }
    };
    let cursor = 0, index;
    while ((index = text.indexOf(term, cursor)) !== -1) {
      appendRange(cursor, index);
      result.push([term, reading]);
      cursor = index + term.length;
    }
    appendRange(cursor, text.length);
    return result;
  }
  // Keep matching leading kana and okurigana outside the ruby annotation.
  function alignKana(text, reading) {
    let start = 0, end = text.length, readingEnd = reading.length;
    const kana = character => /[\u3040-\u30ff]/.test(character);
    while (start < end && start < readingEnd && kana(text[start]) && text[start] === reading[start]) start++;
    while (end > start && readingEnd > start && kana(text[end - 1]) && text[end - 1] === reading[readingEnd - 1]) { end--; readingEnd--; }
    return { prefix: text.slice(0, start), base: text.slice(start, end), annotation: reading.slice(start, readingEnd), suffix: text.slice(end) };
  }
  function parseLrc(input) {
    const entries = [];
    const offset = Number(input.match(/\[offset:([+-]?\d+)\]/i)?.[1] || 0) / 1000;
    for (const line of input.replace(/^\uFEFF/, "").split(/\r?\n/)) {
      const tags = [...line.matchAll(/\[(\d+):([0-5]\d)(?:[.:](\d{1,3}))?\]/g)];
      const text = line.replace(/\[[^\]]*\]/g, "").trim();
      for (const tag of tags) {
        const start = Math.max(0, Number(tag[1]) * 60 + Number(tag[2]) + Number(`0.${tag[3] || 0}`) + offset);
        entries.push(block(text, start));
      }
    }
    entries.sort((a, b) => a.start - b.start);
    if (!entries.length) throw new Error("No timed LRC lines found.");
    // Blank timestamped lines remain boundaries for instrumental gaps.
    return entries.map((row, i) => ({ ...row, end: entries.slice(i + 1).find(next => next.start > row.start)?.start ?? null }));
  }
  function importLyrics(text) {
    if (/\[\d+:[0-5]\d/.test(text)) return parseLrc(text);
    const rows = text.replace(/^\uFEFF/, "").split(/\r?\n/)
      .filter(line => line.trim() && !/^\[[a-z]+:.*\]$/i.test(line.trim())).map(line => block(line));
    if (!rows.length) throw new Error("No lyrics found.");
    return rows;
  }
  function exportLrc(value, timed = true) {
    const project = exportProject(value);
    if (!project.blocks.length) throw new Error("Add lyrics first.");
    const text = row => row.text.replace(/[\r\n]+/g, " ");
    if (!timed) return project.blocks.map(text).join("\n") + "\n";
    if (project.blocks.some(row => row.start === null || row.start + project.offset < 0)) {
      throw new Error("Every line needs a non-negative video start time. Mark untimed lines or export untimed LRC.");
    }
    const timestamp = seconds => {
      const ms = Math.round(seconds * 1000);
      return `[${String(Math.floor(ms / 60000)).padStart(2, "0")}:${String(Math.floor(ms / 1000) % 60).padStart(2, "0")}.${String(ms % 1000).padStart(3, "0")}]`;
    };
    const rows = [...project.blocks].sort((a, b) => a.start - b.start);
    const lines = [];
    rows.forEach((row, index) => {
      lines.push(timestamp(row.start + project.offset) + text(row));
      if (row.end !== null && (!rows[index + 1] || row.end < rows[index + 1].start)) {
        lines.push(timestamp(row.end + project.offset));
      }
    });
    return lines.join("\n") + "\n";
  }
  function activeBlock(rows, videoTime, offset = 0) {
    let active = null;
    for (const row of rows) {
      if (row.start !== null && row.start + offset <= videoTime && (!active || row.start >= active.start)) active = row;
    }
    if (!active || (active.end !== null && videoTime >= active.end + offset) || !active.text.trim()) return null;
    return active;
  }
  function stamp(rows, index, time) {
    if (!rows[index] || !Number.isFinite(time) || time < 0) throw new Error("No valid line or playback time.");
    const previous = rows[index - 1];
    if (previous?.start !== null && previous?.start >= time) throw new Error("The next line must start after the previous line.");
    if (previous?.start !== null && previous) { previous.end = time; delete previous.sweep; }
    delete rows[index].sweep;
    rows[index].start = time;
    if (rows[index].end !== null && rows[index].end <= time) rows[index].end = null;
  }
  function matchTranslation(rows, input, allowMismatch = false) {
    const targets = rows.filter(row => row.text.trim());
    const lines = input.replace(/^\uFEFF/, "").split(/\r?\n/).map(line => line.trim()).filter(Boolean);
    if (!targets.length) throw new Error("Load lyrics first.");
    if (!lines.length) throw new Error("Paste a translation first.");
    if (lines.length !== targets.length && !allowMismatch) {
      const error = new Error(`Translation has ${lines.length} non-empty lines; lyrics have ${targets.length}. Apply anyway will keep unmatched original lines unchanged and ignore extra translation lines.`);
      error.code = "TRANSLATION_LINE_COUNT";
      throw error;
    }
    return targets.slice(0, lines.length).map((row, index) => ({ row, text: lines[index] }));
  }
  function moveLineStart(value, row, videoSeconds) {
    const index = value.blocks.indexOf(row);
    if (index < 0) throw new Error("Load lyrics and select a line first.");
    if (videoSeconds !== null && !Number.isFinite(videoSeconds)) throw new Error("Invalid start time.");
    const start = videoSeconds === null ? null : Number((videoSeconds - value.offset).toFixed(3));
    const delta = start === null || row.start === null ? 0 : start - row.start;
    const blocks = value.blocks.map((block, position) => {
      if (position < index) return block;
      const shift = time => time === null ? null : Number((time + delta).toFixed(3));
      const result = { ...block, start: position === index ? start : shift(block.start), end: shift(block.end) };
      if (result.sweep) {
        if (position === index && start === null) delete result.sweep;
        else result.sweep = result.sweep.map(part => ({ ...part, start: shift(part.start), end: shift(part.end) }));
      }
      return result;
    });
    // Validate the entire shift before applying any times to the current project.
    validate({ ...value, blocks });
    for (let position = index; position < blocks.length; position++) {
      value.blocks[position].start = blocks[position].start;
      value.blocks[position].end = blocks[position].end;
      if (blocks[position].sweep) value.blocks[position].sweep = blocks[position].sweep;
      else delete value.blocks[position].sweep;
    }
  }
  function syncLine(value, row, seconds) {
    if (!row || !value.blocks.includes(row)) throw new Error("Load lyrics and select a line first.");
    if (!Number.isFinite(seconds)) throw new Error("Invalid start time.");
    const previousStart = row.start, previousOffset = value.offset;
    if (row.start === null) row.start = Number((seconds - value.offset).toFixed(3));
    else value.offset = Number((seconds - row.start).toFixed(3));
    try { validate(value); }
    catch (error) { row.start = previousStart; value.offset = previousOffset; throw error; }
  }
  const api = { validateSweep, sweepPosition, displayDefaults, languages, singleTranslation, renameTranslationLanguage, exportProject, fingerprint, mergeTranslations, replaceFuriganaTerm, validateFurigana, alignKana, block, project, validate, parseLrc, importLyrics, exportLrc, activeBlock, stamp, matchTranslation, moveLineStart, syncLine };
  root.KaraokeCore = api;
  if (typeof module !== "undefined") module.exports = api;
})(globalThis);
