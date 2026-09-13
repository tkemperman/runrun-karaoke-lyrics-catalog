/* GitHub catalog protocol shared with the repository index generator. */
(function (root) {
  "use strict";
  const C = root.KaraokeCore || require('./core.js');
  function repository(value) {
    if (typeof value !== "string") throw new Error("Enter a GitHub repository as owner/repository.");
    const repo = value.trim().replace(/^https:\/\/github\.com\//, "").replace(/\/$/, "").replace(/\.git$/, "");
    if (!/^[A-Za-z0-9][A-Za-z0-9-]*\/[A-Za-z0-9_.-]+$/.test(repo) || repo.split('/')[1] === '.' || repo.split('/')[1] === '..') throw new Error("Enter a GitHub repository as owner/repository.");
    return repo;
  }
  function settings(value = {}) {
    const result = {};
    for (const side of ['retrieval', 'publishing']) {
      const source = value[side] || {};
      const branch = source.branch?.trim() || 'main';
      if (typeof branch !== 'string' || branch.length > 200 || !/^[A-Za-z0-9_./-]+$/.test(branch) || branch.includes('..') || branch.startsWith('/') || branch.endsWith('/')) throw new Error('Invalid repository branch.');
      result[side] = { repo: source.repo ? repository(source.repo) : '', branch };
    }
    return result;
  }
  function path(value) {
    if (typeof value !== 'string' || !/^translations\/(?:[\p{L}\p{M}\p{N}_-]+\/)*[\p{L}\p{M}\p{N}_.-]+\.json$/u.test(value) || value.includes('..')) throw new Error('Invalid catalog file path.');
    return value;
  }
  function titleSlug(title) {
    const slug = title.normalize('NFC').toLowerCase().replace(/\s+/gu, '-').replace(/[^\p{L}\p{M}\p{N}-]/gu, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
    // Leave room for the video ID within a filesystem's 255-byte component limit.
    let result = '';
    for (const character of slug) {
      if (new TextEncoder().encode(result + character).length > 220) break;
      result += character;
    }
    return result.replace(/-$/g, '') || 'untitled';
  }
  function encodedPath(file) { return file.split('/').map(encodeURIComponent).join('/'); }
  function cleanProject(value) {
    const p = C.validate(value);
    // Export only protocol fields, never arbitrary imported metadata or settings.
    return { schemaVersion: p.schemaVersion, videoId: p.videoId, videoUrl: p.videoUrl, videoTitle: p.videoTitle, title: p.title, artist: p.artist, originalLanguage: p.originalLanguage, translationLanguage: p.translationLanguage, offset: p.offset, furiganaEnabled: p.furiganaEnabled,
      source: p.source,
      blocks: p.blocks.map(b => ({ id: b.id, text: b.text, start: b.start, end: b.end, translations: b.translations, ...(b.furigana ? { furigana: b.furigana } : {}) })) };
  }
  function entry(value, file) {
    const p = cleanProject(value);
    return { file: path(file), videoId: p.videoId, title: p.title, artist: p.artist, originalLanguage: p.originalLanguage, translationLanguage: p.translationLanguage };
  }
  function index(value) {
    if (value?.schemaVersion !== 1 || !Array.isArray(value.entries) || value.entries.length > 20000) throw new Error('Invalid repository index.');
    const seen = new Set();
    return value.entries.map(e => {
      path(e?.file);
      if (seen.has(e.file) || !/^[\w-]{11}$/.test(e.videoId)) throw new Error('Invalid catalog entry.');
      seen.add(e.file);
      for (const key of ['title', 'artist', 'originalLanguage', 'translationLanguage']) if (typeof e[key] !== 'string' || e[key].length > 2000) throw new Error('Invalid catalog metadata.');
      return { file: e.file, videoId: e.videoId, title: e.title, artist: e.artist, originalLanguage: e.originalLanguage, translationLanguage: e.translationLanguage };
    });
  }
  async function json(url, options = {}, missing = false) {
    const response = await fetch(url, { credentials: 'omit', redirect: 'error', cache: 'no-store', ...options, signal: AbortSignal.timeout(30000) });
    if (missing && response.status === 404) return null;
    if (!response.ok) throw new Error(`GitHub request failed (${response.status}). Check repository, branch, token permissions and branch protection.`);
    const text = await response.text();
    if (text.length > 3000000) throw new Error('Repository file exceeds 3 MB.');
    try { return JSON.parse(text); } catch (_) { throw new Error('Repository returned invalid JSON.'); }
  }
  function raw(source, file) {
    if (!source.repo) throw new Error('Configure a retrieval repository in Settings first.');
    return `https://raw.githubusercontent.com/${repository(source.repo)}/${encodeURIComponent(source.branch)}/${encodedPath(file)}`;
  }
  async function catalog(source) { return index(await json(raw(source, 'index.json'))); }
  async function retrieve(source, file, videoId) {
    const project = cleanProject(await json(raw(source, path(file))));
    if (project.videoId !== videoId) throw new Error('This project belongs to another video. Open its YouTube video before loading.');
    return project;
  }
  function destination(source, value, videoTitle) {
    const project = cleanProject(value);
    if (!source.repo) throw new Error('Configure an upload repository in Settings first.');
    if (!/^[a-zA-Z]{2,8}(-[a-zA-Z0-9]{1,8})*$/.test(project.translationLanguage)) throw new Error('Choose a valid translation language before publishing.');
    if (typeof videoTitle !== 'string' || !videoTitle.trim() || videoTitle.length > 2000) throw new Error('Wait for the YouTube video title before publishing.');
    project.videoTitle = videoTitle;
    const file = `translations/${titleSlug(videoTitle)}-${project.videoId}/${project.translationLanguage}.json`;
    return { project, file, url: `https://api.github.com/repos/${repository(source.repo)}/contents/${encodedPath(file)}` };
  }
  function auth(token) {
    if (!token) throw new Error('Save a GitHub token in Settings first.');
    return { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}`, 'X-GitHub-Api-Version': '2026-03-10' };
  }
  async function inspect(source, token, value, videoTitle) {
    const d = destination(source, value, videoTitle);
    const existing = await json(`${d.url}?ref=${encodeURIComponent(source.branch)}`, { headers: auth(token) }, true);
    if (existing && (existing.type !== 'file' || !/^[a-f0-9]{40,64}$/.test(existing.sha))) throw new Error('Invalid upload destination.');
    return { file: d.file, sha: existing?.sha || null };
  }
  async function commitIdentity(token) {
    const user = await json('https://api.github.com/user', { headers: auth(token) });
    if (!user || typeof user.login !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9-]*$/.test(user.login) || !Number.isSafeInteger(user.id) || user.id <= 0) throw new Error('Could not determine a safe GitHub commit identity.');
    // Never use the account email returned by GitHub: it may be private.
    const email = `${user.id}+${user.login}@users.noreply.github.com`;
    return { name: user.login, email };
  }
  async function publish(source, token, value, sha, videoTitle) {
    const d = destination(source, value, videoTitle);
    if (sha !== null && (typeof sha !== 'string' || !/^[a-f0-9]{40,64}$/.test(sha))) throw new Error('Check the upload destination again.');
    const text = JSON.stringify(d.project, null, 2) + '\n';
    const bytes = new TextEncoder().encode(text);
    if (bytes.length > 3000000) throw new Error('Project exceeds 3 MB.');
    const identity = await commitIdentity(token);
    let binary = ''; for (const byte of bytes) binary += String.fromCharCode(byte);
    await json(d.url, { method: 'PUT', headers: { ...auth(token), 'Content-Type': 'application/json' }, body: JSON.stringify({ author: identity, committer: identity, message: `Publish karaoke: ${d.project.videoId} (${d.project.translationLanguage})`, content: btoa(binary), branch: source.branch, ...(sha ? { sha } : {}) }) });
    return { file: d.file };
  }
  const api = { repository, settings, path, titleSlug, cleanProject, entry, index, catalog, retrieve, inspect, publish };
  root.KaraokeRepositories = api;
  if (typeof module !== 'undefined') module.exports = api;
})(globalThis);
