# ルンルンKARAOKE Lyrics Catalog

Public lyrics and translation catalog for ルンルンKARAOKE.

Repository: `tkemperman/runrun-karaoke-lyrics-catalog`  
Branch: `main`

The included GitHub Action validates project files and updates `index.json` after uploads.

In ルンルンKARAOKE Settings, set the retrieval repository and branch. For uploads, set the upload repository and branch separately and save a fine-grained GitHub personal access token restricted to that repository with **Contents: read and write**. Blank token input keeps the saved token; the remove checkbox deletes it. Never commit your token. Public retrieval never uses it.

In the YouTube lyrics editor, open **Lyrics repositories · GitHub**. **Search repository** fetches `index.json`, initially showing projects for the current video. A title, artist or video ID filter searches the entire catalog. Loading requires the matching YouTube video and confirms replacement of existing work. There is no background polling or automatic replacement.

**Publish project to GitHub** confirms the exact repository, branch and filename before uploading the complete schema 2 project. Files use `translations/VIDEO_ID/LANGUAGE.json`: one project per video and selected translation language, containing all translation languages present in that project. Re-publishing updates that file. Concurrent changes cause an error; check and publish again. Other contributors need write access and their own token; this version does not create forks or pull requests.

A push to `translations/` triggers the included Action, which validates every project and regenerates `index.json`. Allow the Action to finish and raw GitHub caches to refresh before searching again. Failed validation leaves the previous index intact; inspect the workflow logs, fix the file, and rerun. Protected branches or read-only workflow permissions can prevent index commits. The Action never publishes lyrics by itself.

## Format

Project files use the add-on's JSON export schema (1 imports migrate to 2). Keep `scripts/core.js` and `scripts/repositories.js` aligned with the add-on when upgrading validation. The generated index has its own schema version:

```json
{
  "schemaVersion": 1,
  "entries": [
    {
      "file": "translations/abcdefghijk/en.json",
      "videoId": "abcdefghijk",
      "title": "Example song",
      "artist": "Example artist",
      "originalLanguage": "ja",
      "translationLanguage": "en"
    }
  ]
}
```

Generate locally with `node scripts/build-index.js` (Node 22 or newer). Paths must stay within `translations/`; files and catalog must not exceed 3 MB. This template contains no lyrics. Choose appropriate terms for the content you add; the add-on's code license does not automatically license song lyrics.
