# Publishing

Paper Workspace is published to two registries:

| Registry | Used by | Listing |
|---|---|---|
| [Visual Studio Marketplace](https://marketplace.visualstudio.com/manage/publishers/GroverLee) | VS Code | https://marketplace.visualstudio.com/items?itemName=GroverLee.paper-workspace |
| [Open VSX](https://open-vsx.org/namespace/GroverLee) | Cursor, Windsurf / Devin, VSCodium, Gitpod and other VS Code forks | https://open-vsx.org/extension/GroverLee/paper-workspace |

Both use the publisher / namespace `GroverLee` (the `publisher` field in `package.json`), so the extension id is
`GroverLee.paper-workspace`. The id cannot change after the first release.

## Release checklist

1. **Bump the version** in `package.json` (and `package-lock.json`, or run `npm version <x.y.z> --no-git-tag-version`).
   Both registries reject a version that was already published.
2. **Add a section** for the version at the top of `CHANGELOG.md`.
3. **Check the listing text**: `README.md` is the marketplace page. Relative links are rewritten to GitHub
   (`https://github.com/brucegroverlee/paper-workspace/blob/HEAD/...`), so anything it links to must be pushed.
   Images must use `https` URLs and cannot be SVG.
4. **Verify and package**:
   ```bash
   npm run typecheck
   npm test
   npm run test:integration
   npm run package
   ```
   This writes `paper-workspace-<version>.vsix`. Install it locally (*Extensions* → `…` → *Install from VSIX…*) and
   smoke-test it.
5. **Commit, tag and push**:
   ```bash
   git commit -am "chore: release <version>"
   git tag v<version>
   git push && git push --tags
   ```
6. **Publish** to both registries (below).
7. Optionally create a [GitHub release](https://github.com/brucegroverlee/paper-workspace/releases/new) for the tag and
   attach the `.vsix`, for people who install by hand.

## Visual Studio Marketplace

**First release of a new extension (web upload, no token):**

1. Open https://marketplace.visualstudio.com/manage/publishers/GroverLee and sign in with the Microsoft account that
   owns the publisher.
2. **New extension** → **Visual Studio Code** → upload the `.vsix`.
3. Verification takes a few minutes; then the listing is live.

**Updates:** on the same page, open the extension's **…** menu → **Update** and upload the new `.vsix`. Or, from the
command line with a personal access token (Azure DevOps → *User settings* → *Personal access tokens*, organization
*All accessible organizations*, scope *Marketplace → Manage*):

```bash
npx vsce publish --packagePath paper-workspace-<version>.vsix -p <token>
```

## Open VSX

Needs an access token from https://open-vsx.org/user-settings/tokens (sign in with GitHub; the account must be a
member of the `GroverLee` namespace, and the Eclipse publisher agreement must be signed).

```bash
npx ovsx publish paper-workspace-<version>.vsix -p <token>
```

The same command publishes the first release and every update. The namespace is verified, so the listing shows the
verified badge. Cursor syncs from Open VSX, so a new version can take from a few hours to a day to show up there.

## Tokens

Never commit tokens. Instead of `-p`, you can set them in the environment: `VSCE_PAT` for `vsce` and `OVSX_PAT` for
`ovsx`.

## Preview flag

`"preview": true` in `package.json` shows a **Preview** badge on both listings. Remove it once the extension is
considered stable.
