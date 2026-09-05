# Getting feedback from testers

**Status: the channel is wired and has never carried a real report.** The script and the
EAS workflow are in place and verified against an empty feedback list; the first genuine
tester submission is still the thing that proves it end to end.

## What a tester does

Nothing they have to learn. On the iPhone, inside RunIt:

1. Take a screenshot (side button + volume up), **or** wait for a crash.
2. TestFlight offers *Share Beta Feedback* — tap it, type a sentence, send.

No GitHub account, no terminal, no bug-report form. Apple collects it.

## What happens next

`tools/feedback-to-issues.mjs` turns each submission into a GitHub issue carrying the
tester's own words, their device and iOS version, the build number, and the screenshot.
It runs two ways, and they are the same code path:

```
pnpm feedback:sync      # by hand, files everything not yet filed
```

and automatically, via `.eas/workflows/testflight-feedback.yml`, which App Store Connect
triggers the moment a tester submits.

Issues arrive labelled `tester-feedback` or `crash-report`.

## What it deliberately does not record

`testerEmail`. App Store Connect gives it to us and the script drops it: this repo is
private today and might not always be, git history is permanent, and the tester's *name*
is enough to know who to thank. The address is one click away in App Store Connect when
you need to reply.

## Turning the automatic half on

The script works with no setup beyond a `gh auth login`. The workflow needs one thing:

```
eas env:create --name RUNIT_GH_TOKEN --visibility secret --environment production
eas env:create --name EXPO_TOKEN     --visibility secret --environment production
```

`RUNIT_GH_TOKEN` is a **fine-grained** GitHub token scoped to this repo alone, with
`Contents: read+write` and `Issues: read+write` — not the broad `repo` scope a local
`gh` login carries. `EXPO_TOKEN` is a robot user's token, present because it is the one
thing about the automated lane that could not be verified from here: eas-cli advertises
this invocation as workflow usage, but Expo does not document whether `eas` is ambiently
authenticated inside a custom job.

Be honest about the exposure: EAS environments are not per-job secret scopes. A secret in
`production` reaches anything selecting `production`, including production builds. It is
never bundled into the app — only `EXPO_PUBLIC_*` are inlined — but it is present in that
VM. The narrow fine-grained scope is the mitigation, not the environment.

Until both exist the workflow is inert and `pnpm feedback:sync` is the whole channel,
which is exactly why the script was built to stand alone.
