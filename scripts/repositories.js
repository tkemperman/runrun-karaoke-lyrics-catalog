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
    // Read legacy settings once; all callers now share one destination.
    const source = value.repository || (value.publishing?.repo ? value.publishing : value.retrieval?.repo ? value.retrieval : null);
    const branch = source?.branch?.trim() || 'main';
    if (typeof branch !== 'string' || branch.length > 200 || !/^[A-Za-z0-9_./-]+$/.test(branch) || branch.includes('..') || branch.startsWith('/') || branch.endsWith('/')) throw new Error('Invalid repository branch.');
    const repo = source ? (source.repo?.trim() ? repository(source.repo) : '') : 'tkemperman/runrun-karaoke-lyrics-catalog';
    return { repository: { repo, branch }, retrieval: { repo, branch }, publishing: { repo, branch } };
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
  function cleanProject(value) { return C.exportProject(value); }
  function translationLanguages(p) {
    const stored = [...new Set(p.blocks.flatMap(row => Object.keys(row.translations)))].sort();
    return stored.length ? stored : [p.translationLanguage];
  }
  function entry(value, file) {
    const p = cleanProject(value);
    return { file: path(file), videoId: p.videoId, title: p.title, artist: p.artist, originalLanguage: p.originalLanguage, translationLanguage: p.translationLanguage, translationLanguages: translationLanguages(p) };
  }
  function index(value) {
    if (value?.schemaVersion !== 1 || !Array.isArray(value.entries) || value.entries.length > 20000) throw new Error('Invalid repository index.');
    const seen = new Set();
    return value.entries.map(e => {
      path(e?.file);
      if (seen.has(e.file) || !/^[\w-]{11}$/.test(e.videoId)) throw new Error('Invalid catalog entry.');
      seen.add(e.file);
      for (const key of ['title', 'artist', 'originalLanguage', 'translationLanguage']) if (typeof e[key] !== 'string' || e[key].length > 2000) throw new Error('Invalid catalog metadata.');
      return { file: e.file, videoId: e.videoId, title: e.title, artist: e.artist, originalLanguage: e.originalLanguage, translationLanguage: e.translationLanguage, translationLanguages: Array.isArray(e.translationLanguages) && e.translationLanguages.every(l => typeof l === "string" && /^[a-zA-Z]{2,8}(-[a-zA-Z0-9]{1,8})*$/.test(l)) ? e.translationLanguages : [e.translationLanguage] };
    });
  }
  async function json(url, options = {}, missing = false) {
    const response = await fetch(url, { credentials: 'omit', redirect: 'error', cache: 'no-store', ...options, signal: AbortSignal.timeout(30000) });
    if (missing && response.status === 404) return null;
    if (!response.ok) {
      const errors = { 401: 'GitHub token is invalid.', 403: 'GitHub access denied. Check write permissions, branch protection and rate limits.', 404: 'GitHub repository, branch or file was not found, or the token cannot access it.', 409: 'GitHub content changed. Review the destination again.', 422: 'GitHub update rejected. The branch may have changed; review it again.' };
      throw new Error(errors[response.status] || `GitHub request failed (${response.status}). Try again later.`);
    }
    const text = await response.text();
    if (text.length > 3000000) throw new Error('Repository file exceeds 3 MB.');
    try { return JSON.parse(text); } catch (_) { throw new Error('Repository returned invalid JSON.'); }
  }
  function raw(source, file) {
    if (!source.repo) throw new Error('GitHub repository is missing.');
    return `https://raw.githubusercontent.com/${repository(source.repo)}/${encodeURIComponent(source.branch)}/${encodedPath(file)}`;
  }
  async function catalog(source) {
    const entries = index(await json(raw(source, 'index.json'))), choices = new Map();
    for (const entry of entries) for (const language of entry.translationLanguages) {
      const key = `${entry.videoId}:${language}`;
      if (!choices.has(key) || entry.file.endsWith(`/${language}.json`)) choices.set(key, { ...entry, translationLanguage: language });
    }
    return [...choices.values()].sort((a, b) => (a.translationLanguage === 'en' ? -1 : b.translationLanguage === 'en' ? 1 : a.translationLanguage.localeCompare(b.translationLanguage)));
  }
  async function retrieve(source, file, videoId) {
    const project = cleanProject(await json(raw(source, path(file))));
    if (project.videoId !== videoId) throw new Error('This project belongs to another video. Open its YouTube video before loading.');
    return project;
  }
  function destination(source, value, videoTitle) {
    const project = cleanProject(value);
    if (!source.repo) throw new Error('GitHub repository is missing.');
    if (!/^[a-zA-Z]{2,8}(-[a-zA-Z0-9]{1,8})*$/.test(project.translationLanguage)) throw new Error('Choose a valid translation language before publishing.');
    if (typeof videoTitle !== 'string' || !videoTitle.trim() || videoTitle.length > 2000) throw new Error('Wait for the YouTube video title before publishing.');
    project.videoTitle = videoTitle;
    const file = `translations/${titleSlug(videoTitle)}-${project.videoId}/${project.translationLanguage}.json`;
    return { project, file, url: `https://api.github.com/repos/${repository(source.repo)}/contents/${encodedPath(file)}` };
  }
  function auth(token) {
    if (!token) throw new Error('GitHub token is missing.');
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
  function apiRoot(source) {
    if (!source.repo) throw new Error('GitHub repository is missing.');
    return `https://api.github.com/repos/${repository(source.repo)}`;
  }
  async function apiRequest(source, token, suffix, method = 'GET', body) {
    return json(`${apiRoot(source)}${suffix}`, { method, headers: { ...auth(token), 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
  }
  async function inspectBatch(source, token, value, videoTitle) {
    const p = cleanProject(value);
    if (!videoTitle?.trim()) throw new Error('Wait for the YouTube video title before publishing.');
    const ref = await apiRequest(source, token, `/git/ref/heads/${encodedPath(source.branch)}`);
    const sha = ref.object?.sha;
    if (!/^[a-f0-9]{40,64}$/.test(sha)) throw new Error('Invalid GitHub branch revision.');
    const commit = await apiRequest(source, token, `/git/commits/${sha}`);
    const tree = await apiRequest(source, token, `/git/trees/${commit.tree.sha}?recursive=1`);
    if (tree.truncated || !Array.isArray(tree.tree)) throw new Error('Repository is too large to review safely.');
    const files = translationLanguages(p).map(language => {
      const existing = tree.tree.filter(e => e.type === 'blob' && e.path.startsWith('translations/') &&
        (e.path.includes(`-${p.videoId}/`) || e.path.startsWith(`translations/${p.videoId}/`)) && e.path.endsWith(`/${language}.json`));
      if (existing.length > 1) throw new Error(`Multiple ${language} files exist for this video. Resolve duplicates before publishing.`);
      return { language, file: existing[0]?.path || `translations/${titleSlug(videoTitle)}-${p.videoId}/${language}.json`, sha: existing[0]?.sha || null };
    });
    files.forEach(e => path(e.file));
    return { sha, tree: commit.tree.sha, files, file: files.map(e => e.file).join('\n') };
  }
  async function publishBatch(source, token, value, sha, videoTitle) {
    const reviewed = await inspectBatch(source, token, value, videoTitle);
    if (reviewed.sha !== sha) throw new Error('GitHub content changed. Review the destination again.');
    const p = cleanProject(value); p.videoTitle = videoTitle;
    const identity = await commitIdentity(token);
    const tree = reviewed.files.map(item => {
      const copy = { ...p, translationLanguage: item.language, blocks: p.blocks.map(row => ({ ...row,
        translations: { [item.language]: row.translations[item.language] || '' } })) };
      const content = JSON.stringify(copy, null, 2) + '\n';
      if (new TextEncoder().encode(content).length > 3000000) throw new Error('Project exceeds 3 MB.');
      return { path: item.file, mode: '100644', type: 'blob', content };
    });
    const createdTree = await apiRequest(source, token, '/git/trees', 'POST', { base_tree: reviewed.tree, tree });
    const commit = await apiRequest(source, token, '/git/commits', 'POST', {
      message: `Publish karaoke: ${p.videoId} (${reviewed.files.map(f => f.language).join(', ')})`,
      tree: createdTree.sha, parents: [sha], author: identity, committer: identity });
    await apiRequest(source, token, `/git/refs/heads/${encodedPath(source.branch)}`, 'PATCH', { sha: commit.sha, force: false });
    return { files: reviewed.files, revision: commit.sha };
  }
  async function inspectDelete(source, token, file, videoId) {
    const existing = await apiRequest(source, token, `/contents/${encodedPath(path(file))}?ref=${encodeURIComponent(source.branch)}`);
    if (existing.type !== 'file' || !/^[a-f0-9]{40,64}$/.test(existing.sha)) throw new Error('Invalid GitHub file.');
    const bytes = Uint8Array.from(atob(existing.content.replace(/\s/g, '')), c => c.charCodeAt(0));
    const p = cleanProject(JSON.parse(new TextDecoder().decode(bytes)));
    if (p.videoId !== videoId) throw new Error('Selected file belongs to another video.');
    return { file, sha: existing.sha, languages: C.languages(p) };
  }
  async function remove(source, token, file, sha, videoId) {
    const current = await inspectDelete(source, token, file, videoId);
    if (current.sha !== sha) throw new Error('GitHub file changed. Review deletion again.');
    const identity = await commitIdentity(token);
    await apiRequest(source, token, `/contents/${encodedPath(path(file))}`, 'DELETE', {
      message: `Delete karaoke: ${videoId} (${file})`, sha, branch: source.branch, author: identity, committer: identity });
    return true;
  }
  const api = { inspectBatch, publishBatch, inspectDelete, remove, repository, settings, path, titleSlug, cleanProject, entry, index, catalog, retrieve, inspect, publish };
  root.KaraokeRepositories = api;
  if (typeof module !== 'undefined') module.exports = api;
})(globalThis);
