# ルンルンKARAOKE Lyrics Catalog

Set up your own public lyrics and translation repository for [ルンルンKARAOKE](https://github.com/tkemperman/runrun-karaoke).

## Setup

1. **Fork this repository.** Click [Fork](https://github.com/tkemperman/runrun-karaoke-lyrics-catalog/fork), select your account, and create the fork. Use your fork's name in step 4. A local clone is optional; the extension uploads directly to GitHub. To start with an empty catalog, use the add-on's `lyrics-repository-template/` instead.

2. **Enable GitHub Actions.** In your repository, open **Actions** and enable workflows if prompted. Run **Update lyrics catalog → Run workflow** on `main` and wait for it to finish successfully.

3. **Create a GitHub token.** Open [Fine-grained personal access tokens](https://github.com/settings/personal-access-tokens) and click **Generate new token**. Give it a name and expiration date, select your account as **Resource owner**, and choose **Only select repositories → your new repository**. Under **Repository permissions**, set **Contents → Read and write**, then generate and copy the token. [GitHub's token guide](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens) has more detail.

4. **Configure ルンルンKARAOKE.** Open the extension's **Settings → Lyrics repositories · GitHub** and enter:

   | Field | Value |
   | --- | --- |
   | Retrieval repository | `YOUR-USERNAME/YOUR-REPOSITORY` |
   | Retrieval branch | `main` |
   | Upload repository | `YOUR-USERNAME/YOUR-REPOSITORY` |
   | Upload branch | `main` |
   | GitHub token | The token you just copied |

   Settings save automatically when you leave a field. Keep the token private; never add it to the repository.

5. **Publish or load lyrics.** On YouTube, open the lyrics editor and expand **Lyrics repositories · GitHub**. Use **Publish project to GitHub** to upload your project. After the repository's Action finishes, use **Search repository** to find and load it.

## License

Code and technical documentation are licensed under [MIT](LICENSE).
**Lyrics and translations are excluded**; rights remain with their respective
rights holders. See [CONTENT_NOTICE.md](CONTENT_NOTICE.md).
