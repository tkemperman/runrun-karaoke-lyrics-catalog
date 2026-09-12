/* Shared by Firefox extension contexts and the Node test suite. */
(function (root) {
  "use strict";
  const id = () => globalThis.crypto.randomUUID();
  function block(text = "", start = null, end = null) {
    return { id: id(), start, end, text, translations: {} };
  }
  function project(videoId, title = "") {
    return { schemaVersion: 2, furiganaEnabled: false, videoId, title, artist: "", originalLanguage: "ja", translationLanguage: "en", offset: 0, sources: [], blocks: [] };
  }
  function validate(value) {
    if (!value || ![1, 2].includes(value.schemaVersion)) throw new Error("Unsupported project schema.");
    value = { ...value };
    if (value.schemaVersion === 1) {
      value.schemaVersion = 2;
      value.furiganaEnabled = false;
    }
    if (typeof value.furiganaEnabled !== "boolean") throw new Error("Invalid furigana visibility.");
    if (!/^[\w-]{11}$/.test(value.videoId)) throw new Error("Invalid YouTube video ID.");
    for (const key of ["title", "artist", "originalLanguage", "translationLanguage"]) {
      if (typeof value[key] !== "string" || value[key].length > 2000) throw new Error(`Invalid ${key}.`);
    }
    if (!Number.isFinite(value.offset) || Math.abs(value.offset) > 86400) throw new Error("Invalid timing offset.");
    if (!Array.isArray(value.blocks) || value.blocks.length > 10000) throw new Error("Invalid block list.");
    if (!Array.isArray(value.sources) || value.sources.length > 100) throw new Error("Invalid sources.");
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
      if (!row.translations || typeof row.translations !== "object" || Array.isArray(row.translations)) throw new Error("Invalid translations.");
      for (const [language, text] of Object.entries(row.translations)) {
        if (!/^[a-zA-Z]{2,8}(-[a-zA-Z0-9]{1,8})*$/.test(language) || typeof text !== "string" || text.length > 20000) throw new Error("Invalid translation entry.");
      }
    }
    for (const source of value.sources) {
      if (!source || typeof source.provider !== "string" || typeof source.url !== "string" || !/^https:\/\//.test(source.url)) throw new Error("Invalid source link.");
    }
    return JSON.parse(JSON.stringify(value));
  }
  function validateFurigana(text, parts) {
    if (!Array.isArray(parts) || parts.length > text.length || parts.some(part =>
      !Array.isArray(part) || part.length !== 2 || typeof part[0] !== "string" || !part[0] ||
      (part[1] !== null && (typeof part[1] !== "string" || !/^[\p{Script=Hiragana}\p{Script=Katakana}ー・\s]+$/u.test(part[1]) || part[1].length > 1000))) ||
      parts.map(part => part[0]).join("") !== text) throw new Error("Invalid furigana: segments must exactly match the original lyrics and readings must be kana.");
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
    if (previous?.start !== null && previous) previous.end = time;
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
  function syncLine(value, row, seconds) {
    if (!row || !value.blocks.includes(row)) throw new Error("Load lyrics and select a line first.");
    if (!Number.isFinite(seconds)) throw new Error("Invalid start time.");
    const previousStart = row.start, previousOffset = value.offset;
    if (row.start === null) row.start = Number((seconds - value.offset).toFixed(3));
    else value.offset = Number((seconds - row.start).toFixed(3));
    try { validate(value); }
    catch (error) { row.start = previousStart; value.offset = previousOffset; throw error; }
  }
  const api = { replaceFuriganaTerm, validateFurigana, alignKana, block, project, validate, parseLrc, activeBlock, stamp, matchTranslation, syncLine };
  root.KaraokeCore = api;
  if (typeof module !== "undefined") module.exports = api;
})(globalThis);
