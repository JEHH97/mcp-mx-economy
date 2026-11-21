# Publishing mcp-mx-economy to npm

This guide is for the maintainer who publishes the package. The project is an MCP server distributed as a CLI (`bin`), so the goal is that users can run it with `npx -y mcp-mx-economy` without cloning the repository.

Nothing in this guide needs a secret stored in the repository. npm credentials stay in your npm account and local npm configuration.

## 1. Prerequisites

- An npm account. Create it yourself at <https://www.npmjs.com/signup> if you do not have one.
- Node.js 20 or newer and npm (the project's CI uses Node 24).
- A clean working tree on the release commit: `git status` shows nothing to commit.

## 2. Enable two-factor authentication (2FA)

2FA is strongly recommended for any account that publishes packages. Depending on your npm account settings, `npm publish` may require it.

1. Sign in at npmjs.com and open **Account settings → Two-factor authentication**.
2. Enable 2FA with an authenticator app (TOTP) or a security key.
3. Choose the level **"Authorization and publishing"** so that `npm publish` asks for a one-time password (OTP) or a web confirmation.
4. Save the recovery codes in a password manager. They are not stored in this repository.

## 3. Check the package name

The unscoped name `mcp-mx-economy` was not in the npm registry when this guide was written (`npm view mcp-mx-economy` returned 404). Check again right before publishing, because the name is first-come, first-served:

```sh
npm view mcp-mx-economy name version
```

- **404 / not found:** the name is free. Continue.
- **A version is printed:** another author owns the name. Do not publish under it. Switch to the scoped name `@jehh97/mcp-mx-economy` by changing `name` in `package.json` and the `npx` commands in `README.md` and this guide, then reconsider `publishConfig.access: "public"` (scoped packages are private by default).

## 4. Log in to npm

```sh
npm login --auth-type=web
npm whoami
```

`npm login` opens a browser flow that completes 2FA. `npm whoami` must print your npm username. If you prefer a token, create a **granular access token** with publish rights to this package in the npm web UI, and keep it in your password manager or an environment variable such as `NPM_TOKEN`. Never commit it, and never put it in `.npmrc` inside this repository.

## 5. Verify the release candidate

Run the full check from the repository root. Use the same container wrapper as the rest of the project:

```sh
scripts/in-dev npm ci
scripts/in-dev npm run check
```

`check` runs lint, formatting, typecheck, tests with coverage, the production build, a stdio smoke test of `dist/index.js` (direct and through a symlink, as npm exposes the binary), and the forbidden-content scan. `prepublishOnly` runs `check` again before any publish.

Inspect exactly what the tarball will contain:

```sh
scripts/in-dev npm pack --dry-run
```

Expected files: `LICENSE`, `README.md`, `package.json`, and `dist/index.js` (plus any other files emitted into `dist/`). There must be no `src/`, `test/`, `scripts/`, `.github/`, `.env*`, `node_modules/`, or coverage output. If a file is missing or extra, fix `files` in `package.json` before continuing.

Optionally, install the tarball into a scratch directory outside the repository to confirm the binary starts:

```sh
TMP_DIR=$(mktemp -d /tmp/opencode/mcp-mx-economy-pack.XXXXXX)
scripts/in-dev npm pack --pack-destination "$TMP_DIR"
# Remove the generated tarball afterwards; it must not stay in the repository.
rm -rf "$TMP_DIR"
```

Bump `version` in `package.json` for every release. npm does not allow overwriting a published version.

## 6. Publish

```sh
npm publish --access public
```

If 2FA is enabled, npm prompts for the OTP or opens the web confirmation. To pass an OTP explicitly, use `npm publish --access public --otp=<6-digit-code>` (the code expires quickly; do not store it).

Run `npm publish` only from a clean tree at the release commit. Publishing is irreversible for a given version: `npm unpublish` is restricted and should be avoided. To retract a bad release, publish a fixed patch version and deprecate the bad one with `npm deprecate mcp-mx-economy@<version> "<message>"`.

## 7. Verify the published package

From a machine or directory with no local copy of the repository:

```sh
npm view mcp-mx-economy version
npx -y mcp-mx-economy@latest < /dev/null
```

Starting the server over stdio with no input should exit cleanly without printing anything to stdout. For a real protocol check, add the package to an MCP client (see the README) and confirm that the eight `mx_*` tools are listed. Tools that query data need `BANXICO_TOKEN` or `INEGI_TOKEN` in the client's `env`; without them the server still starts and those tools return a setup message.

Then update the npm line at the top of `README.md` with the published status, and link the npm page from the portfolio (`demoKind: "npm"`).

## Troubleshooting

- **`E403` or "two-factor authentication required":** complete the OTP or web confirmation, or re-run `npm login --auth-type=web`.
- **`E404` on publish:** you are not logged in to the expected account, or the name is taken. Re-run `npm whoami` and step 3.
- **`npx` seems to do nothing:** a stdio server prints nothing until an MCP client sends a message, so silence on stdout is normal. To see startup errors, run the local build with `node dist/index.js` from a clone; errors are written to stderr.
- **Tools report a missing token:** set `BANXICO_TOKEN` / `INEGI_TOKEN` in the MCP client configuration. Values in `.env.example` are placeholders and are not read automatically from the package.
