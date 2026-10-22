#!/usr/bin/env bash
# Release @signwithsigil/cli: bump the minor version, run the tests, publish to npm.
#
#   ./publish.sh              # 1.0.0 -> 1.1.0, test, publish
#   ./publish.sh --patch      # 1.0.0 -> 1.0.1 instead
#   ./publish.sh --major      # 1.0.0 -> 2.0.0 instead
#   ./publish.sh --dry-run    # everything except the upload (npm publish --dry-run); the bump is undone
#
# The npm account's second factor is a passkey, which only npm 10+ can use (it opens the browser), so the
# upload runs through `npx npm@latest`. Nothing is committed or tagged: commit package.json and tag the
# release yourself afterwards (the script prints the commands). This file is not in the package: package.json's
# "files" list is the whitelist of what npm uploads.
set -euo pipefail
cd "$(dirname "$0")"

BUMP="minor"
DRY_RUN=""
for arg in "$@"; do
    case "$arg" in
        --minor|--patch|--major) BUMP="${arg#--}" ;;
        --dry-run) DRY_RUN="--dry-run" ;;
        -h|--help) sed -n '2,13p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
        *) echo "Unknown option: $arg" >&2; exit 2 ;;
    esac
done

NAME="$(node -p "require('./package.json').name")"
OLD="$(node -p "require('./package.json').version")"

if [[ -n "$(git status --porcelain --untracked-files=no)" ]]; then
    echo "Warning: the working tree has uncommitted changes; they will be published." >&2
fi

if npm whoami >/dev/null 2>&1; then
    echo "npm user: $(npm whoami)"
else
    echo "Not logged in to npm. Run 'npm login' first." >&2
    exit 1
fi

# Bump without the commit and tag npm would otherwise make.
NEW="$(npm version "$BUMP" --no-git-tag-version)"
NEW="${NEW#v}"
echo "$NAME: $OLD -> $NEW"

restore() {
    npm version "$OLD" --no-git-tag-version --allow-same-version >/dev/null
    echo "Version put back to $OLD." >&2
}

if ! npm test; then
    restore
    exit 1
fi

# npm 10+ handles the passkey challenge by opening the browser; the machine's own npm may be older.
if ! npx -y npm@latest publish $DRY_RUN; then
    echo "Publish failed." >&2
    restore
    exit 1
fi

if [[ -n "$DRY_RUN" ]]; then
    restore
    echo "Dry run only; nothing was uploaded."
    exit 0
fi

echo
echo "Published $NAME@$NEW. Now commit and tag it:"
echo "  git commit -am 'Release $NEW' && git tag v$NEW && git push && git push --tags"
